import { spawn, execFile } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const hostname = "127.0.0.1";
const services = {
  dispatch: { port: 5176, directory: "apps/paw-patrol" },
  officer: { port: 5177, directory: "apps/paw-patrol" },
  hospital: { port: 5178, directory: "apps/paw-patrol" },
  map: { port: 5173, directory: "." },
};

export const help = `Usage: npm run dev -- [dispatch officer hospital map]

With no arguments, starts dispatch, officer, and hospital.
Choose one or more names to start only those services.

  dispatch  http://localhost:5176
  officer   http://localhost:5177
  hospital  http://localhost:5178
  map       http://localhost:5173  (optional original map)

Examples:
  npm run dev
  npm run dev -- officer hospital
  npm run dev -- dispatch officer hospital map
  npm run dev:map

Ctrl+C stops every server started by this launcher.
`;

export function selectServices(args) {
  const selected = args.length ? args : ["dispatch", "officer", "hospital"];
  for (const name of selected) {
    if (!Object.hasOwn(services, name)) {
      throw new Error(`Unknown service '${name}'. Use --help to see the options.`);
    }
  }
  return [...new Set(selected)];
}

export function createCommands(names, root = repositoryRoot, env = process.env) {
  return names.map((name) => {
    const service = services[name];
    const cwd = path.join(root, service.directory);
    const childEnv = { ...env };
    // Inherited role settings must never leak into another service.
    delete childEnv.PAW_PATROL_WORKSPACE;
    delete childEnv.PAW_PATROL_DIST_DIR;
    if (name !== "map") {
      childEnv.PAW_PATROL_WORKSPACE = name;
      childEnv.PAW_PATROL_DIST_DIR = `.next-${name}`;
    }
    return {
      name,
      port: service.port,
      cwd,
      command: process.execPath,
      args: [
        path.join(cwd, "node_modules/next/dist/bin/next"),
        "dev",
        "--hostname",
        hostname,
        "--port",
        String(service.port),
      ],
      env: childEnv,
    };
  });
}

async function reservePort(service) {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", (error) => {
      const reason =
        error.code === "EADDRINUSE"
          ? "already in use. Stop the existing server in its terminal first"
          : `unavailable (${error.code})`;
      reject(new Error(`${service.name}: port ${service.port} is ${reason}.`));
    });
    server.listen({ port: service.port, host: hostname, exclusive: true }, resolve);
  });
  return server;
}

export async function preflight(commands) {
  const checkedDirectories = new Set();
  for (const service of commands) {
    if (checkedDirectories.has(service.cwd)) continue;
    checkedDirectories.add(service.cwd);
    const manifest = JSON.parse(await readFile(path.join(service.cwd, "package.json"), "utf8"));
    const dependencies = {
      ...manifest.dependencies,
      ...manifest.devDependencies,
    };
    try {
      await Promise.all([
        access(service.args[0]),
        ...Object.keys(dependencies).map((name) =>
          access(path.join(service.cwd, "node_modules", name, "package.json")),
        ),
      ]);
    } catch {
      const install =
        service.name === "map"
          ? "pnpm install --frozen-lockfile"
          : "npx --yes npm@11.6.2 ci --prefix apps/paw-patrol";
      throw new Error(
        `${service.name}: dependencies are missing. From the repository root, run '${install}'.`,
      );
    }
  }

  // Hold all selected ports until every check passes, then release them before
  // starting Next. Next receives explicit ports and fails if a later race occurs.
  const reservations = [];
  try {
    for (const service of commands) reservations.push(await reservePort(service));
  } finally {
    await Promise.all(
      reservations.map((server) => new Promise((resolve) => server.close(resolve))),
    );
  }
}

function groupExists(pid) {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    return error.code !== "ESRCH";
  }
}

async function terminateTree(child, signal) {
  if (!child.pid) return;
  if (process.platform === "win32") {
    // Windows has no POSIX process groups. Limit taskkill to this child tree.
    const args = ["/PID", String(child.pid), "/T"];
    if (signal === "SIGKILL") args.push("/F");
    try {
      await execFileAsync("taskkill", args, { windowsHide: true });
    } catch {
      if (child.exitCode === null && child.signalCode === null) {
        await execFileAsync("taskkill", [...args, "/F"], {
          windowsHide: true,
        }).catch(() => child.kill("SIGKILL"));
      }
    }
    return;
  }
  try {
    process.kill(-child.pid, signal);
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
}

export async function runServices(
  commands,
  {
    signals = process,
    stdout = process.stdout,
    stderr = process.stderr,
    spawnChild = spawn,
    terminate = terminateTree,
    isAlive = (child) =>
      child.pid &&
      (process.platform === "win32"
        ? child.exitCode === null && child.signalCode === null
        : groupExists(child.pid)),
    graceMs = 5000,
  } = {},
) {
  const children = [];
  let stopping = false;
  let forced = false;
  let exitCode = 0;
  let shutdownTimer;
  let pollTimer;
  let finish;
  const finished = new Promise((resolve) => {
    finish = resolve;
  });

  function completeIfStopped() {
    if (
      stopping &&
      children.every(({ closed }) => closed) &&
      (forced || children.every(({ child }) => !isAlive(child)))
    ) {
      clearTimeout(shutdownTimer);
      clearInterval(pollTimer);
      finish(exitCode);
    }
  }

  function signalChildren(signal) {
    return Promise.all(
      children.map(({ child }) =>
        terminate(child, signal).catch((error) => {
          stderr.write(`[launcher] Could not stop a child: ${error.message}\n`);
          exitCode = 1;
        }),
      ),
    );
  }

  function stop(code, message) {
    if (stopping) return;
    stopping = true;
    exitCode = code;
    stdout.write(`[launcher] ${message}\n`);
    void signalChildren("SIGTERM").then(() => completeIfStopped());
    pollTimer = setInterval(() => completeIfStopped(), 100);
    shutdownTimer = setTimeout(() => {
      forced = true;
      void signalChildren("SIGKILL").then(() => completeIfStopped());
    }, graceMs);
  }

  const onInterrupt = () => stop(130, "Stopping all servers (Ctrl+C)...");
  const onTerminate = () => stop(143, "Stopping all servers (SIGTERM)...");
  signals.on("SIGINT", onInterrupt);
  signals.on("SIGTERM", onTerminate);

  for (const service of commands) {
    if (stopping) break;
    stdout.write(`[${service.name}] Starting at http://localhost:${service.port}\n`);
    let child;
    try {
      child = spawnChild(service.command, service.args, {
        cwd: service.cwd,
        env: service.env,
        shell: false,
        detached: process.platform !== "win32",
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      stop(1, `${service.name} could not start: ${error.message}`);
      break;
    }
    const record = { child, closed: false };
    children.push(record);
    for (const [input, output] of [
      [child.stdout, stdout],
      [child.stderr, stderr],
    ]) {
      if (!input) continue;
      const lines = createInterface({ input });
      lines.on("line", (line) => output.write(`[${service.name}] ${line}\n`));
    }
    child.once("error", (error) => {
      stop(1, `${service.name} could not start: ${error.message}`);
    });
    child.once("close", (code, signal) => {
      record.closed = true;
      if (!stopping) {
        stop(
          code || 1,
          `${service.name} exited unexpectedly (${signal ?? code}); stopping all servers.`,
        );
      }
      completeIfStopped();
    });
  }

  try {
    return await finished;
  } finally {
    clearTimeout(shutdownTimer);
    clearInterval(pollTimer);
    signals.off("SIGINT", onInterrupt);
    signals.off("SIGTERM", onTerminate);
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(help);
    return;
  }
  const commands = createCommands(selectServices(args));
  await preflight(commands);
  process.exitCode = await runServices(commands);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`[launcher] ${error.message}`);
    process.exitCode = 1;
  });
}
