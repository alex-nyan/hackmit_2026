import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const requireNext = createRequire(import.meta.resolve("next/package.json"));
const { loadEnvConfig } = requireNext("@next/env");

const root = fileURLToPath(new URL("../", import.meta.url));
const service = path.join(root, "services/triage");
const envFile = path.join(root, ".env.local");
const python = path.join(service, ".venv/bin/python");
const children = new Set();

async function run(command, args, cwd = service) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: "inherit", env: process.env });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)),
    );
  });
}

async function setup() {
  await run("uv", ["sync", "--locked", "--extra", "whisper", "--inexact"]);
  await run(python, [
    "-c",
    'from faster_whisper import WhisperModel; WhisperModel("base.en", device="cpu", compute_type="int8", download_root="models/whisper"); print("Speech model ready")',
  ]);
  let text = await readFile(envFile, "utf8").catch(() => "");
  const defaults = {
    AUDIO_AI_PROVIDER: "ollama",
    AUDIO_AI_MODEL: "llama3.2:3b",
    TRIAGE_URL: "http://127.0.0.1:8091",
    TRIAGE_API_TOKEN: randomBytes(32).toString("hex"),
    TRIAGE_TIMEOUT_SECONDS: "45",
    PAW_PATROL_INCIDENT_STORE: "local",
  };
  const added = [];
  for (const [key, value] of Object.entries(defaults)) {
    const setting = new RegExp(`^[\\t ]*(?:export[\\t ]+)?${key}[\\t ]*=[^\\r\\n]*`, "gm");
    const matches = [...text.matchAll(setting)];
    // Empty placeholders are common after copying .env.example. Preserve every
    // nonempty configured value, but fill blank assignments (including quotes).
    const current = matches.at(-1)?.[0].split("=").slice(1).join("=").trim();
    if (current && !/^(?:""|'')?(?:\s*#.*)?$/.test(current)) continue;
    text = matches.length ? text.replace(setting, `${key}=${value}`) : `${text}\n${key}=${value}\n`;
    added.push(key);
  }
  await writeFile(envFile, text, { mode: 0o600 });
  console.log(
    `Audio demo configured. Added settings: ${added.join(", ") || "none (existing settings kept)"}.`,
  );
  console.log(
    "Start Ollama, then pnpm dev:audio. If dashboards are already running, use pnpm dev:speech instead.",
  );
}

async function start() {
  loadEnvConfig(root, true);
  if (!process.env.TRIAGE_API_TOKEN) throw new Error("Run pnpm setup:audio first.");
  const snapshots = path.join(
    service,
    "models/whisper/models--Systran--faster-whisper-base.en/snapshots",
  );
  const snapshot = (await readdir(snapshots).catch(() => []))[0];
  if (!snapshot) throw new Error("Speech model missing. Run pnpm setup:audio first.");
  const port = new URL(process.env.TRIAGE_URL || "http://127.0.0.1:8091").port || "8091";
  function launch(command, args, cwd, extra = {}) {
    const child = spawn(command, args, {
      cwd,
      stdio: "inherit",
      env: { ...process.env, ...extra },
    });
    children.add(child);
    child.on("error", (error) => {
      console.error(error.message);
      stop(1);
    });
    child.on("exit", (code) => {
      children.delete(child);
      stop(code || 0);
    });
  }
  let stopping = false;
  function stop(code = 0) {
    if (stopping) return;
    stopping = true;
    children.forEach((child) => child.kill("SIGTERM"));
    process.exitCode = code;
  }
  process.on("SIGINT", () => stop());
  process.on("SIGTERM", () => stop());
  launch(
    python,
    ["-m", "uvicorn", "triage.app:create_app", "--factory", "--host", "127.0.0.1", "--port", port],
    service,
    {
      TRIAGE_TRANSCRIPTION_ENABLED: "true",
      TRIAGE_WHISPER_MODEL: path.join(snapshots, snapshot),
      TRIAGE_YOLO_ENABLED: "false",
      TRIAGE_LIVE_ENABLED: "false",
      TRIAGE_DATABASE_PATH: "data/audio-demo.sqlite3",
      TRIAGE_MAX_AUDIO_SECONDS: "30",
      TRIAGE_MAX_CLIP_AGE_SECONDS: "120",
    },
  );
  if (!process.argv.includes("--speech-only")) launch(process.execPath, ["scripts/dev.mjs"], root);
  console.log(
    "Audio demo: http://localhost:5176/audio · Officer: http://localhost:5177/audio · shared incident log",
  );
}

try {
  if (process.argv.includes("--setup")) await setup();
  else await start();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
