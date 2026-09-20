# Situation inputs and workspace reports

The browser/demo workspaces now use this path:

- Camera capture (Officer, `/capture`, joined phone, Dispatch) posts `/api/triage`. The route archives the frame, requests inference, validates the result, and publishes hazards or visual context into the shared incident log.
- Audio posts `/api/transcribe`. The route publishes transcript hypotheses to the camera wall and incident log. Distress terms request review; other speech remains context.
- HeartCast receives Bluetooth heart rate in the browser. In **Review situation & medic report**, the operator can connect the device and explicitly share a single current reading for the selected profile. Continuous samples remain local. The receipt timestamp and operator-assigned wearer travel with the snapshot.
- All three workspaces show an always-visible AI situation card. Recent concerns take priority over routine observations. Open it to inspect source-specific camera, audio, heart-rate snapshots, and history. Camera/audio context expires after 60 seconds and shared heart rate after 30 seconds; these are display freshness budgets, not medical thresholds. A disconnected log suppresses current context.
- **Prepare from current evidence** creates editable report text. **Save reviewed report to workspaces** publishes it to the shared log. It does not contact an external medic service. No injuries, diagnoses, treatment decisions, or scene clearance are inferred.

Capture times are distinct from publication times. Repeated event IDs are deduplicated. Failed incident publication is exposed in the capture UI separately from successful inference. Missing analysis is not safety confirmation.

`officer-P-01` maps to the explicitly selected demo profile `P-01`; arbitrary phone source IDs remain separate. No face identification or inferred association between camera subjects and heart-rate wearers is performed. Suspect tracks on the demo map remain scripted; AI observations do not turn them into measured locations.

This change targets the browser/demo bus. `PAW_PATROL_DATA_MODE=live` continues using the separate authenticated v2 ingestion, enrollment, incident state, and human handoff implementation described in `live-pipeline.md`.

Deployment requires the existing private Blob store plus `TRIAGE_URL` and `TRIAGE_API_TOKEN`, and provisioned vision/transcription providers in the Python service. The shared demo log retains 200 events and is not a clinical record or evidence archive. The browser demo's shared access gate is not the role-filtered v2 gateway.
