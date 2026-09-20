import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

function setValue(text, key, value) {
  const line = `${key}=${JSON.stringify(value)}`;
  const pattern = new RegExp(`^${key}=.*$`, "m");
  return pattern.test(text) ? text.replace(pattern, () => line) : `${text.trimEnd()}\n${line}\n`;
}

/** Configure both halves together without printing or committing the credential. */
export function configureLocalTriage(root) {
  const frontendPath = path.join(root, ".env.local");
  const servicePath = path.join(root, "services/triage/.env");
  let frontend = existsSync(frontendPath) ? readFileSync(frontendPath, "utf8") : "";
  let service = existsSync(servicePath)
    ? readFileSync(servicePath, "utf8")
    : readFileSync(path.join(root, "services/triage/.env.example"), "utf8");
  const frontEnv = parseEnv(frontend);
  const serviceEnv = parseEnv(service);
  if (
    frontEnv.TRIAGE_URL &&
    !/^http:\/\/(127\.0\.0\.1|localhost):8090\/?$/.test(frontEnv.TRIAGE_URL)
  ) {
    throw new Error(
      "Existing TRIAGE_URL is not the local service. Keep the remote configuration or update it explicitly.",
    );
  }
  const frontToken = frontEnv.TRIAGE_API_TOKEN?.trim();
  const serviceToken = serviceEnv.TRIAGE_API_TOKEN?.trim();
  if (frontToken && serviceToken && frontToken !== serviceToken) {
    throw new Error(
      "The frontend and service tokens differ. Resolve the mismatch before local setup.",
    );
  }
  const token = frontToken || serviceToken || randomBytes(32).toString("hex");
  if (!/^[\x21-\x7e]{32,}$/.test(token))
    throw new Error(
      "The existing triage token must contain at least 32 non-whitespace ASCII characters.",
    );
  frontend = setValue(frontend, "TRIAGE_URL", "http://127.0.0.1:8090");
  frontend = setValue(frontend, "TRIAGE_API_TOKEN", token);
  service = setValue(service, "TRIAGE_API_TOKEN", token);
  service = setValue(service, "TRIAGE_TRANSCRIPTION_ENABLED", "true");
  // A new local setup uses a model that fits a 16 GB development Mac. Existing
  // service deployments keep their deliberately selected vision model.
  if (!existsSync(servicePath)) service = setValue(service, "TRIAGE_OLLAMA_MODEL", "gemma3:4b");
  if (existsSync(path.join(root, "services/triage/models/whisper-base/model.bin"))) {
    service = setValue(service, "TRIAGE_WHISPER_MODEL", "models/whisper-base");
  }
  for (const [filename, contents] of [
    [frontendPath, frontend],
    [servicePath, service],
  ]) {
    writeFileSync(filename, contents, { mode: 0o600 });
    chmodSync(filename, 0o600);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  configureLocalTriage(fileURLToPath(new URL("../", import.meta.url)));
  console.log("Local triage configured; camera and audio share a private server token.");
  console.log(
    "Install dependencies and models as described in README.md, then run npm run dev:triage.",
  );
  console.log("Restart the frontend after configuration changes.");
}
