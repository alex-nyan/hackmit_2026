# Live pipeline integration smoke

From the repository root, run:

```sh
services/triage/.venv/bin/python services/triage/scripts/live_smoke.py
```

The script uses the triage service's existing Python dependencies. It starts the real ASGI application with **uvicorn in a separate process**, bound only to an automatically selected `127.0.0.1` port. It exercises actual HTTP and SSE connections, then restarts the process against the same temporary database.

Successful output ends with `PASS complete: 10 loopback checks; no downloads or external calls.` A failed check exits with status 1 and a concise diagnostic. Tokens and response bodies are never printed.

The ten checks cover:

1. An isolated local service starts with model inference disabled.
2. Authenticated source telemetry reaches the operator snapshot with its original value, wearer and measurement time.
3. A real SSE connection replays the committed telemetry revision and cursor.
4. Retrying assistance with the same key returns the original receipt and creates one alert.
5. Dispatch acknowledgment and an attributable human scene report become visible to the officer; acknowledgment leaves the alert open.
6. Hospital access excludes responder Watch measurements even with an explicit source grant. Source-role incident reads, unassigned incident reads and anonymous access are denied.
7. Dispatch records human-authored MIST handoffs for two explicitly enrolled simulated patients. The hospital sees only its assigned patient and handoff; the officer sees neither. Missing fields remain unknown, attribution is human-reported, and delivery remains “recorded locally, not transmitted.”
8. Media returns HTTP 202 admission, then independently publishes unavailable inference because the detector is disabled. No detections or evidence are invented.
9. Process restart retains assistance, acknowledgment, human scene reports, patient handoff text/attribution/local-only delivery, access isolation and idempotency; source coverage becomes unknown and old observations remain stale.
10. Both server processes have stopped and the temporary databases have been removed.

Credentials are generated randomly in memory and sent to the child process through a private stdin pipe. No credentials appear in process arguments or repository files. The script ignores inherited `TRIAGE_*` configuration, uses no existing `.env` file, and writes databases only inside an automatically removed temporary directory. Models, transcription and cloud fallback are explicitly disabled; the configured local model endpoint is unused. The HTTP client ignores proxy environment variables.

Startup has a 10-second deadline, HTTP operations have short timeouts, SSE/media waits have 4-second deadlines, and shutdown escalates from termination to a bounded kill if needed. Cleanup runs on check failures as well as success. This smoke uses Unix socket-descriptor inheritance and supports this repository's macOS/Linux development environments.

If the execution sandbox denies opening the local listening socket, run this exact script with approved local-socket execution. No public interface or fixed port is required.

This verifies backend integration and failure semantics. It does not establish YOLO/Whisper/Gemma accuracy or latency, native iPhone/Watch behavior, browser rendering, responder usability, or operational readiness. Those require their respective model evaluations, browser checks and paired-device acceptance tests.
