import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { PassThrough, Writable } from "node:stream";
import test from "node:test";

import { createCommands, preflight, runServices, selectServices } from "./dev.mjs";

test("default startup selects all three workspaces; subsets retain their order", () => {
  assert.deepEqual(selectServices([]), ["dispatch", "officer", "hospital"]);
  assert.deepEqual(selectServices(["hospital", "map", "hospital"]), ["hospital", "map"]);
  // pnpm forwards the separator; npm removes it. Both must reach the same set.
  assert.deepEqual(selectServices(["--", "officer"]), ["officer"]);
  assert.deepEqual(selectServices(["--"]), ["dispatch", "officer", "hospital"]);
  assert.throws(() => selectServices(["unknown"]), /Unknown service/);
  assert.throws(() => selectServices(["__proto__"]), /Unknown service/);
});

test("service commands isolate caches and override inherited role configuration", () => {
  const commands = createCommands(["dispatch", "officer", "hospital", "map"], "/project", {
    PAW_PATROL_WORKSPACE: "wrong",
    PAW_PATROL_DIST_DIR: "wrong",
    PATH: "preserved",
  });
  assert.deepEqual(
    commands.map(({ port }) => port),
    [5176, 5177, 5178, 5173],
  );
  for (const service of commands.slice(0, 3)) {
    assert.equal(service.cwd, "/project");
    assert.equal(service.command, process.execPath);
    assert.equal(service.env.PAW_PATROL_WORKSPACE, service.name);
    assert.equal(service.env.PAW_PATROL_DIST_DIR, `.next-${service.name}`);
    assert.equal(service.env.PATH, "preserved");
    assert.deepEqual(service.args.slice(1), [
      "dev",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(service.port),
    ]);
  }
  // map serves every route from the same app; it just pins no role.
  assert.equal(commands[3].cwd, "/project");
  assert.equal(commands[3].env.PAW_PATROL_WORKSPACE, undefined);
  assert.equal(commands[3].env.PAW_PATROL_DIST_DIR, undefined);
});

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "paw-patrol-launcher-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const commands = createCommands(["dispatch", "officer"], root, {});
  await mkdir(commands[0].cwd, { recursive: true });
  await writeFile(
    path.join(commands[0].cwd, "package.json"),
    JSON.stringify({ dependencies: { next: "test", react: "test" } }),
  );
  return commands;
}

async function installFixture(commands) {
  for (const name of ["next", "react"]) {
    const directory = path.join(commands[0].cwd, "node_modules", name);
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, "package.json"), "{}");
  }
  await mkdir(path.dirname(commands[0].args[0]), { recursive: true });
  await writeFile(commands[0].args[0], "");
}

async function listen() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return server;
}

async function close(server) {
  await new Promise((resolve) => server.close(resolve));
}

test("preflight gives the correct install command for missing app dependencies", async (t) => {
  const commands = await fixture(t);
  await assert.rejects(preflight(commands), /pnpm install --frozen-lockfile/);
});

test("preflight checks all dependencies, not just the Next binary", async (t) => {
  const commands = await fixture(t);
  await installFixture(commands);
  await rm(path.join(commands[0].cwd, "node_modules/react"), {
    recursive: true,
  });
  await assert.rejects(preflight(commands), /dependencies are missing/);
});

test("preflight releases earlier reservations when a later port is occupied", async (t) => {
  const commands = await fixture(t);
  await installFixture(commands);
  const free = await listen();
  commands[0].port = free.address().port;
  await close(free);
  const occupied = await listen();
  t.after(() => close(occupied));
  commands[1].port = occupied.address().port;

  await assert.rejects(preflight(commands), /officer: port .*already in use/);
  const reclaimed = createServer();
  reclaimed.listen(commands[0].port, "127.0.0.1");
  await once(reclaimed, "listening");
  await close(reclaimed);
});

test("successful preflight leaves selected ports available to the servers", async (t) => {
  const commands = await fixture(t);
  await installFixture(commands);
  commands.forEach((command) => {
    command.port = 0;
  });
  await preflight(commands);
});

class FakeChild extends EventEmitter {
  constructor(pid) {
    super();
    this.pid = pid;
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
    this.exitCode = null;
    this.signalCode = null;
    this.alive = true;
  }

  close(code, signal = null) {
    this.exitCode = code;
    this.signalCode = signal;
    this.alive = false;
    this.stdout.end();
    this.stderr.end();
    this.emit("close", code, signal);
  }
}

function harness(overrides = {}) {
  const children = [];
  const stops = [];
  const signals = new EventEmitter();
  let output = "";
  const stream = new Writable({
    write(chunk, encoding, callback) {
      output += chunk.toString();
      callback();
    },
  });
  const options = {
    signals,
    stdout: stream,
    stderr: stream,
    spawnChild(command, args, settings) {
      assert.equal(settings.shell, false);
      assert.equal(settings.stdio[0], "ignore");
      const child = new FakeChild(children.length + 1);
      children.push(child);
      return child;
    },
    async terminate(child, signal) {
      stops.push([child.pid, signal]);
      if (child.alive) child.close(null, signal);
    },
    isAlive: (child) => child.alive,
    graceMs: 20,
    ...overrides,
  };
  return { children, stops, signals, options, output: () => output };
}

test("Ctrl+C stops every child, labels logs, and removes signal handlers", async () => {
  const fixture = harness();
  const result = runServices(createCommands(["dispatch", "officer", "hospital"]), fixture.options);
  fixture.children[1].stdout.write("ready\n");
  fixture.signals.emit("SIGINT");
  assert.equal(await result, 130);
  assert.deepEqual(fixture.stops, [
    [1, "SIGTERM"],
    [2, "SIGTERM"],
    [3, "SIGTERM"],
  ]);
  assert.match(fixture.output(), /\[officer\] ready/);
  assert.equal(fixture.signals.listenerCount("SIGINT"), 0);
  assert.equal(fixture.signals.listenerCount("SIGTERM"), 0);
});

test("an unexpected clean exit is a failure and stops sibling services", async () => {
  const fixture = harness();
  const result = runServices(createCommands(["dispatch", "officer"]), fixture.options);
  fixture.children[0].close(0);
  assert.equal(await result, 1);
  assert.equal(fixture.children[1].alive, false);
  assert.match(fixture.output(), /dispatch exited unexpectedly/);
});

test("a startup error stops other services without leaving an unhandled error", async () => {
  const fixture = harness();
  const result = runServices(createCommands(["dispatch", "officer"]), fixture.options);
  fixture.children[1].emit("error", new Error("spawn failed"));
  assert.equal(await result, 1);
  assert.equal(fixture.children[0].alive, false);
  assert.match(fixture.output(), /officer could not start: spawn failed/);
});

test("a synchronous spawn error also shuts down already started children", async () => {
  const fixture = harness();
  const spawnChild = fixture.options.spawnChild;
  fixture.options.spawnChild = (...args) => {
    if (fixture.children.length) throw new Error("bad executable");
    return spawnChild(...args);
  };
  assert.equal(await runServices(createCommands(["dispatch", "officer"]), fixture.options), 1);
  assert.equal(fixture.children[0].alive, false);
});

test("shutdown forcefully stops children that ignore the graceful signal", async () => {
  const stops = [];
  const fixture = harness({
    async terminate(child, signal) {
      stops.push(signal);
      if (signal === "SIGKILL") child.close(null, signal);
    },
  });
  const result = runServices(createCommands(["officer"]), fixture.options);
  fixture.signals.emit("SIGTERM");
  assert.equal(await result, 143);
  assert.deepEqual(stops, ["SIGTERM", "SIGKILL"]);
});

test("an exited parent does not leave a surviving descendant group running", async () => {
  const stops = [];
  let groupAlive = true;
  const fixture = harness({
    isAlive: () => groupAlive,
    async terminate(child, signal) {
      stops.push(signal);
      if (signal === "SIGTERM") child.close(null, signal);
      if (signal === "SIGKILL") groupAlive = false;
    },
  });
  const result = runServices(createCommands(["officer"]), fixture.options);
  fixture.signals.emit("SIGTERM");
  assert.equal(await result, 143);
  assert.deepEqual(stops, ["SIGTERM", "SIGKILL"]);
});

test(
  "real subprocess receives shutdown through its isolated process group",
  { skip: process.platform === "win32", timeout: 5000 },
  async () => {
    const signals = new EventEmitter();
    let output = "";
    const stdout = new Writable({
      write(chunk, encoding, callback) {
        output += chunk.toString();
        if (chunk.toString().includes("fixture-ready")) {
          signals.emit("SIGINT");
        }
        callback();
      },
    });
    const result = await runServices(
      [
        {
          name: "fixture",
          port: 0,
          cwd: os.tmpdir(),
          env: process.env,
          command: process.execPath,
          args: [
            "-e",
            'process.on("SIGTERM", () => { console.log("fixture-stopped"); process.exit(0); }); console.log("fixture-ready"); setInterval(() => {}, 1000);',
          ],
        },
      ],
      { signals, stdout, stderr: stdout, graceMs: 500 },
    );
    assert.equal(result, 130);
    assert.match(output, /fixture-stopped/);
  },
);
