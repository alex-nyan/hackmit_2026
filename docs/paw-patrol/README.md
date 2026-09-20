# Paw Patrol dashboard handoff

- [Updated PDF team brief](Paw_Patrol_Team_Brief_Updated.pdf)
- [Editable Word team brief](Paw_Patrol_Team_Brief_Updated.docx)
- [Dashboard notes](dashboard-readme.md)

The dashboard is served at `/` by the app at the repository root, alongside the fleet map at `/map` and the camera pages at `/capture`. Its map can now show real tracked units, real building facts and real camera triage, each opt-in. The 90-second scenario itself — officers, panic, clinical and dispatch data — remains a labeled simulation.

Consult update: tactical subject descriptions, per-officer panic/acknowledgement, an explicit scene-clearance gate for EMS, and a structured MIST handoff. MIST means Mechanism, Injuries, Signs/symptoms, Treatments. BP, pulse and AVPU remain unknown unless the demo operator enters observations. No treatment recommendations or real dispatch occur. ATAK remains a future integration.

The default 90-second story contains a separate scripted command clearance at 00:56. A manual unsafe/unknown report overrides that script and holds playback before 01:00 transport until command records clearance. Reset/replay clears manual reports and clinical entries. The supplied human model and its CC0 license are included.

Real feeds and the scripted scenario are kept as separate sources and are never merged into one roster: tracked units are drawn over the simulated patrol vehicles, not mixed with them. Keep identity, timestamps, provenance and stale-data handling explicit when extending either.
