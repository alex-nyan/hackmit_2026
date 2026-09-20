import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { runServices } from "./dev.mjs";

const cwd = fileURLToPath(new URL("../services/triage/", import.meta.url));
const python = path.join(
  cwd,
  process.platform === "win32" ? ".venv/Scripts/python.exe" : ".venv/bin/python",
);
if (!existsSync(python) || !existsSync(path.join(cwd, ".env"))) {
  throw new Error(
    "Run npm run setup:triage and install the service dependencies first (see README.md).",
  );
}
const settings = parseEnv(readFileSync(path.join(cwd, ".env"), "utf8"));
const runtime = path.join(cwd, ".runtime");
for (const folder of ["ultralytics", "matplotlib"])
  mkdirSync(path.join(runtime, folder), { recursive: true });
const env = {
  ...process.env,
  YOLO_CONFIG_DIR: path.join(runtime, "ultralytics"),
  MPLCONFIGDIR: path.join(runtime, "matplotlib"),
};
const commands = [];
const ollamaUrl = settings.TRIAGE_OLLAMA_BASE_URL || "http://127.0.0.1:11434";
const ollamaReady = await fetch(`${ollamaUrl.replace(/\/$/, "")}/api/tags`, {
  signal: AbortSignal.timeout(2000),
})
  .then((response) => response.ok)
  .catch(() => false);
if (!ollamaReady && ollamaUrl === "http://127.0.0.1:11434") {
  const localBinary = path.join(runtime, "ollama/ollama");
  commands.push({
    name: "ollama",
    port: 11434,
    cwd,
    command: existsSync(localBinary) ? localBinary : "ollama",
    args: ["serve"],
    env: {
      ...env,
      OLLAMA_HOST: "127.0.0.1:11434",
      OLLAMA_NO_CLOUD: "1",
      OLLAMA_CONTEXT_LENGTH: "8192",
      ...(existsSync(localBinary) ? { OLLAMA_MODELS: path.join(cwd, "models/ollama") } : {}),
    },
  });
}
commands.push({
  name: "triage",
  port: 8090,
  cwd,
  command: python,
  args: [
    "-m",
    "uvicorn",
    "triage.app:create_app",
    "--factory",
    "--host",
    "127.0.0.1",
    "--port",
    "8090",
    "--workers",
    "1",
    "--no-access-log",
  ],
  env,
});
process.exitCode = await runServices(commands, { graceMs: 210_000 });
