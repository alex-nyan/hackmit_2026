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

Remaining phases: isolated media workers and evidence; native Apple capture; live workspace presentation and handoff; integrated fault/replay verification. Actual device builds, hardware latency/endurance, domain-trained weapon performance, and field/clinical qualification require separate evidence and are not established by software unit tests.
