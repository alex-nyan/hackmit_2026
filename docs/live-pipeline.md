# Local audiovisual and Watch pipeline

The implemented path is **Apple capture → authenticated Python service → durable incident state/SSE → live Next.js workspace**. YOLO and ASR have independent native workers. Optional local Gemma visual descriptions cannot create alerts or authorize actions. Paired-device qualification and domain model evaluation remain outstanding.

See the [implementation record](ai-pipeline-implementation.md), [architecture plan](ai-safety-pipeline-plan.md), and [native app instructions](../apps/apple-capture/README.md).

## Run a connected replay first

Install the service dependencies from its lockfile if not already installed:

```sh
cd services/triage
uv sync --locked
uv run --no-sync python -m scripts.live_demo init
uv run --no-sync python -m scripts.live_demo serve
```

Initialization creates private, ignored `.runtime/live-demo.env` and `.runtime/live-demo.credentials.json` files. It will not overwrite existing identities. No models are needed. Sources and the patient record are explicitly labeled simulated.

In another terminal:

```sh
cd services/triage
uv run --no-sync python -m scripts.live_demo replay
```

Set these **server-side** values in `apps/paw-patrol/.env.local`, preserving existing Mapbox configuration:

```dotenv
PAW_PATROL_DATA_MODE=live
TRIAGE_URL=http://127.0.0.1:8090
LIVE_SESSION_SECRET=<64 hexadecimal characters generated with openssl rand -hex 32>
```

From the repository root, use the existing launcher:

```sh
npm run dev
```

Open a workspace on ports 5176–5178 and sign in with an operator token from the private credentials file. The token's server role controls access; a port never grants permissions. Use separate browser profiles for simultaneous roles. Cookies on the same hostname are shared across ports, so one browser profile represents one signed-in operator. A source token cannot create a browser session.

Replay supplies responder Watch/GPS data, unavailable camera coverage and an assistance request. Hospital access excludes responder biometrics. New demo configurations include an assigned simulated patient for manual MIST entry. An existing configuration can use `init --env .runtime/another-demo.env` or add explicit patient enrollment and hospital patient scope.

`PAW_PATROL_DATA_MODE=demo` restores the original synthetic browser scenarios. Live failures never switch to demonstration data.

## Connect actual hardware

1. Build and sign the checked-in [iPhone/Watch project](../apps/apple-capture/README.md) with full Xcode and paired devices. Sharing requires the iPhone capture app to remain active. Watch heart rate uses a deliberately started, legitimate walking workout; it is not an all-shift monitoring service.
2. Copy `services/triage/.env.example` into a private configuration. Enable `TRIAGE_LIVE_ENABLED`, assign incident IDs, and enroll the phone camera, microphone, GPS, device and Watch as separate source IDs. Give each source credential only its assigned source/incident scopes.
3. Enroll the Watch's consenting wearer explicitly. A patient Watch also requires a matching patient in `TRIAGE_LIVE_PATIENTS`. Changing wearer or incident requires a new source ID. Existing source/patient identity bindings are immutable.
4. Configure separate officer, dispatch and hospital principals. Hospitals require explicit source and patient scopes. Officers cannot read patient MIST or patient Watch data. Dispatch can access patients in its incidents; a nonempty `patient_ids` list narrows that scope. No Watch value automatically fills a handoff.
5. Run one ASGI worker behind an HTTPS origin trusted by the phone. Configure the native app with that origin, incident, source prefix, Watch source ID and source credential. Native capture refuses plaintext HTTP and redirects.

```sh
cd services/triage
uv run --no-sync uvicorn triage.app:create_app --factory --host 127.0.0.1 --port 8090 --workers 1 --timeout-graceful-shutdown 5
```

For a browser deployment behind a proxy, set `LIVE_PUBLIC_ORIGIN` to the exact HTTPS browser origin, without a trailing slash. Use HTTPS for off-host `TRIAGE_URL`. The proxy must preserve SSE streaming, forward disconnects, and enforce deployment-level connection/rate limits. Do not expose the development server publicly.

The optional Mapbox basemap uses an external tile service; its viewport can reveal the area viewed. Omit the token where external map requests are inappropriate: measured coordinates and source states remain available. Detector boxes stay in camera coordinates and never become a suspect location or route clearance.

## Enable local models deliberately

Provision the [existing model adapters](hazard-triage.md) before enabling them. Requests do not download weights.

| Component            | Configuration                                                                                                                          | Output and boundary                                                                                                                                       |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Media admission      | `TRIAGE_LIVE_MEDIA_ENABLED=true`                                                                                                       | HTTP 202 means admitted into bounded work, not completed inference.                                                                                       |
| YOLO                 | Install `yolo` extra; local `TRIAGE_YOLO_WEIGHTS`; pin `TRIAGE_YOLO_SHA256`; enable `TRIAGE_YOLO_ENABLED`                              | Normalized camera boxes, checkpoint digest, capture time and explicit failures.                                                                           |
| ASR                  | Install `whisper` extra; `TRIAGE_WHISPER_MODEL` must be an existing CTranslate2 model directory; enable `TRIAGE_TRANSCRIPTION_ENABLED` | Unverified transcript with source/time; no speaker identity or voice biometrics.                                                                          |
| Gemma through Ollama | Provision a supported local model; set `TRIAGE_OLLAMA_MODEL`; enable `TRIAGE_LIVE_CONTEXT_ENABLED`                                     | Optional visual description linked to evidence/revision. Audio/Watch interpretation is not part of this adapter.                                          |
| Weapon review alerts | `TRIAGE_LIVE_EVALUATED_WEAPON_LABELS`                                                                                                  | Defaults empty. Configure exact labels only after evaluating the checkpoint for intended conditions. Generic weights do not establish firearm capability. |

Default capture-age budgets are 3 seconds for frames, 15 seconds for audio and 30 seconds for general telemetry. These are freshness limits, not measured latency guarantees or clinical thresholds. Late inference becomes unavailable. Context is discarded when its evidence/revision changes, so a slow model may produce no current description during an active feed. It never delays detector publication or assistance processing.

No facial recognition, identity matching, intent/aggression inference, individual risk scores, diagnosis, force recommendations or automatic scene clearance is implemented. Human scene reports have scope, attribution, expiry and revocation; eligible new visual evidence requires reassessment. Acknowledgment does not resolve an alert. MIST handoffs are attributed local records with unknown fields preserved; they do not send an external hospital message.

## Component connections

| Producer                   | Interface                                              | Consumer                                                          |
| -------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------- |
| iPhone / Watch relay       | `POST /v2/ingest/telemetry`                            | Enrollment-validated measurements                                 |
| iPhone camera / microphone | `POST /v2/ingest/media`                                | Independent bounded workers                                       |
| Workers                    | Typed `MediaResult` / `ContextSummary`                 | SQLite incident state and event revision                          |
| Operator                   | `GET /v2/incidents/{id}/state`                         | Role-filtered snapshot                                            |
| Event log                  | `GET /v2/incidents/{id}/events`                        | SSE invalidation and gap recovery; frontend refetches state       |
| Human action               | `POST /v2/incidents/{id}/commands` + `Idempotency-Key` | Assistance, acknowledgment, review, scene report, patient handoff |
| Evidence viewer            | `GET /v2/evidence/{id}`                                | Exact authenticated capture, or expired/unavailable               |

Python contracts are canonical. From `services/triage`, regenerate browser types/validators with `python -m scripts.export_contracts`; check drift with `--check`. Native wire models have executable cross-language fixtures. New hardware should implement the same source/boot/sequence/measurement-time envelopes.

## Verification and limits

Run the [real HTTP/SSE/restart smoke](live-smoke.md) without models:

```sh
services/triage/.venv/bin/python services/triage/scripts/live_smoke.py
apps/apple-capture/scripts/verify-core.sh
```

Tests cover stale/replayed data, scopes, overload, worker cancellation, publication failure, evidence expiry, durable commands, patient isolation, SSE recovery, uncertain-action retries and concurrent handoff edits.

Raw v2 evidence is bounded RAM with a maximum TTL and may be evicted earlier; restart removes it. SQLite retains bounded incident history and command receipts. This is not a forensic evidence archive or tamper-proof audit system. Database files use private permissions; SQLite itself does not encrypt them. Use an encrypted host volume, protect backups, and establish incident retention/closure before collecting real data. Reaching command or unresolved-alert capacity produces an explicit failure rather than silently deleting unresolved records.

Before operational use, complete native SDK builds and paired-device tests, checkpoint evaluation on representative gun/knife/hazard footage and hard negatives, concurrent-load latency/thermal/battery measurements, accessibility/usability trials, and deployment privacy/security review. Software tests do not establish detection accuracy, continuous Watch sampling, clinical fitness or operational safety.
