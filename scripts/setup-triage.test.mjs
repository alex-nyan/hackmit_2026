import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseEnv } from "node:util";
import { test } from "node:test";
import assert from "node:assert/strict";
import { configureLocalTriage } from "./setup-triage.mjs";

function fixture(t, frontend = "", service) {
  const root = mkdtempSync(path.join(tmpdir(), "triage-setup-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, "services/triage"), { recursive: true });
  writeFileSync(path.join(root, ".env.local"), frontend);
  writeFileSync(
    path.join(root, "services/triage/.env.example"),
    "TRIAGE_API_TOKEN=\nTRIAGE_TRANSCRIPTION_ENABLED=false\n",
  );
  if (service !== undefined) writeFileSync(path.join(root, "services/triage/.env"), service);
  return root;
}

test("local setup aligns credentials, enables audio, and is idempotent", (t) => {
  const root = fixture(t, "NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN=preserved\nTRIAGE_API_TOKEN=\n");
  configureLocalTriage(root);
  const first = readFileSync(path.join(root, ".env.local"), "utf8");
  const frontend = parseEnv(first);
  const service = parseEnv(readFileSync(path.join(root, "services/triage/.env"), "utf8"));
  assert.equal(frontend.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN, "preserved");
  assert.equal(frontend.TRIAGE_API_TOKEN, service.TRIAGE_API_TOKEN);
  assert.ok(frontend.TRIAGE_API_TOKEN.length >= 32);
  assert.equal(service.TRIAGE_TRANSCRIPTION_ENABLED, "true");
  configureLocalTriage(root);
  assert.equal(readFileSync(path.join(root, ".env.local"), "utf8"), first);
});

test("does not overwrite a remote deployment or mismatched credentials", (t) => {
  const remote = fixture(t, "TRIAGE_URL=https://example.test\n");
  assert.throws(() => configureLocalTriage(remote), /not the local service/);
  const mismatch = fixture(
    t,
    `TRIAGE_API_TOKEN=${"a".repeat(32)}\n`,
    `TRIAGE_API_TOKEN=${"b".repeat(32)}\n`,
  );
  assert.throws(() => configureLocalTriage(mismatch), /tokens differ/);
});
