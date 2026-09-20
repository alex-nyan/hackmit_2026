**AI safety pipeline implementation record**

The architecture is in `docs/ai-safety-pipeline-plan.md`. Work is being implemented in reviewed, tested commits. The existing synthetic demonstration remains explicitly separate from live operation.

**Phase 1 — shared contracts and incident foundation: implemented.**

Canonical Python contracts now generate TypeScript types, runtime validators, and JSON schemas. Existing capture clients reject malformed success responses, including incorrect bounding boxes or missing human-review/provenance fields.

The optional v2 service supplies authenticated source ingestion, incident snapshots, durable revisions, bounded SSE replay, and idempotent human commands. Device enrollment owns wearer identity. Hospitals cannot see responder Watch readings. Human scene reports have scope, expiry, attribution, revocation, and reassessment state. Acknowledgment is separate from resolution. Live mode is disabled unless explicitly configured.

The browser gateway verifies operator credentials, encrypts them into an expiring HttpOnly session, checks write origins, limits request sizes/read time, and forwards only permitted routes. It does not expose the v1 shared service credential or grant access based on workspace port.

Review corrected timestamp-offset ordering, backfill eviction of current readings, removed-source command targeting, scene-report replacement, and SSE cursor recovery. Validation: 189 backend tests passed (one existing optional smoke test skipped); 152 capture/contract frontend tests passed; six gateway tests passed; TypeScript and scoped lint checks passed.

Run the shared incident without model downloads from `services/triage`:

```sh
uv run --no-sync python -m scripts.live_demo init
uv run --no-sync python -m scripts.live_demo serve
```

In another terminal in that directory:

```sh
uv run --no-sync python -m scripts.live_demo replay
```

Initialization creates private files under the ignored `.runtime` directory. The credentials file contains separate source, officer, dispatch, and hospital credentials. Replay uses a dedicated `replay-demo` incident and clearly labeled simulated sources. It must not be used as a fallback for unavailable real devices.

**Phase 2 — isolated media workers and evidence: implemented.**

Authenticated frame/audio admission returns `202 admitted_not_processed`. Video retains the latest pending frame per source; audio has its own bounded queue. Detector/decode and ASR run in separate killable native processes. A timed-out or unreaped worker cannot accept another job. Media, telemetry, and commands have independent HTTP-body admission limits, leaving control capacity available during media overload.

Machine observations retain capture time, source identity, model provenance, sequence, explicit unavailable states, and short per-channel freshness. Detector output is published before optional visual context. Context cannot create alerts or authorize access and is discarded when its evidence/revision has changed. No models are downloaded at runtime; v2 ASR requires a provisioned local model directory. Evaluated weapon labels default to an empty list.

Evidence uses authenticated opaque references and bounded memory with expiry. It is not an evidence archive. The SQLite state/event transaction persists results; publication failures mark inference unavailable. Camera heartbeats cannot make missing/failed inference appear healthy. Schema validation rejects mismatched observation types and inferred subject assignments.

Independent review corrected concurrent upload admission, unreaped process reuse, capture/inference coverage conflation, and contract narrowing. Validation: 219 backend tests passed, one existing optional model smoke skipped; service lint and generated-contract drift checks passed. Real model performance is not established by these tests.

**Phase 3 — native Apple capture: implemented; device qualification pending.**

`apps/apple-capture` contains the checked-in Xcode project, iPhone foreground camera/microphone/GPS capture, explicitly started walking-workout Watch heart rate, mirrored measurements, Keychain credentials, independent bounded HTTPS upload lanes, and assistance request receipts. Original measurement times and enrollment-owned wearer identity cross the wire. Stop/background clears pending sample sharing; a mirrored workout cannot be rebound to another incident/source while active.

Review corrected stop/start races and stale callbacks, audio continuity across dropped buffers, credential replacement during an uncertain assistance request, permission-start cancellation, Watch coverage restoration, and strict receipt identity/version checks. Independent reviewers rechecked those paths. Validation: 39 executable production-core checks, core/relay Swift type checking, native syntax parsing, project/plist validation, and a Swift-encoded telemetry fixture accepted by the Python schema.

This host has Command Line Tools, without iOS/watchOS SDKs or XCTest. Full native SDK compilation, signing, installation, permission behavior, mirroring, and paired-device endurance remain unverified. The native README supplies the build and device acceptance steps; the checks above are not a device-build claim.

**Phase 4 — live workspace and human patient handoff: implemented.**

The dashboard has an explicit live mode with authenticated roles, SSE snapshot recovery, actual source readings, phone locations, camera/audio observations, exact-capture evidence previews, optional unverified context, assistance/review commands and expiring human scene reports. Freshness deadlines advance between server polls. Credentials remain in an encrypted HttpOnly session; HTTPS deployments can declare their canonical browser origin.

Explicit patient enrollments and patient grants protect manual MIST records. Unknown fields remain null, attribution comes from the authenticated human, and records are labeled local rather than externally delivered. Officer/source roles cannot access patient clinical records. Concurrent handoff changes block stale drafts. Uncertain command retries preserve the original body and idempotency key even when the incident revision advances.

Review corrected authorization after grant/roster removal, cached-receipt authorization, restricted dispatch patient scope, bootstrap sign-in races, stale handoff replacement, freshness between polls, and Next's normalized loopback hostname. SQLite databases and sidecars use private file permissions; an encrypted host volume remains necessary for encryption at rest.

Validation: 234 backend tests passed, one optional real-model smoke skipped; 124 dashboard tests and four lockfile tests passed; 241 root app tests and 13 launcher tests passed. Both apps passed TypeScript, lint and production builds. Browser verification exercised sign-in, assistance, acknowledgment, manual handoff, measured readings, interrupted coverage, backend outage and sign-out. The outage retained explicitly stale readings and disabled authoritative report updates; it never substituted demo data.

**Phase 5 — integration verification, runbook and CI: implemented.**

The reproducible `scripts.live_smoke` runs real HTTP/SSE against a separate loopback-only process with private random credentials and temporary databases. Ten checks cover telemetry, SSE revisions, assistance idempotency, human acknowledgment/reporting, responder/patient access isolation, local MIST records, disabled-model failure, durable restart and cleanup. The final frozen implementation passed all ten checks. The existing triage CI now runs this smoke after unit tests and contract drift checks.

The [live pipeline runbook](live-pipeline.md) gives concrete replay, operator, device, model, HTTPS, patient enrollment, interface and validation instructions. The native README distinguishes available host checks from required Xcode/device verification. The demo server has a bounded graceful-shutdown timeout for open SSE connections.

All five software implementation phases have been reviewed and committed. Outstanding qualification remains: full native SDK/device builds and permission/transport tests; representative domain model accuracy and hard-negative evaluation; concurrent-load latency, battery and thermal measurements; deployment privacy/security and field/clinical acceptance. No software test result in this record establishes those properties. No public deployment, external handoff, real device capture, or model download was performed during implementation.
