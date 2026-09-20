# Paw Patrol dashboard handoff

- [Updated PDF team brief](Paw_Patrol_Team_Brief_Updated.pdf)
- [Editable Word team brief](Paw_Patrol_Team_Brief_Updated.docx)
- [Dashboard setup](../../apps/paw-patrol/README.md)

The dashboard is an independent app in `apps/paw-patrol`. The team's root app, live fleet tracking and hazard-triage services are preserved. This dashboard does not yet consume those services; all officer, panic, clinical and dispatch data in it is a labeled simulation.

Consult update: tactical subject descriptions, per-officer panic/acknowledgement, an explicit scene-clearance gate for EMS, and a structured MIST handoff. MIST means Mechanism, Injuries, Signs/symptoms, Treatments. BP, pulse and AVPU remain unknown unless the demo operator enters observations. No treatment recommendations or real dispatch occur. ATAK remains a future integration.

The default 90-second story contains a separate scripted command clearance at 00:56. A manual unsafe/unknown report overrides that script and holds playback before 01:00 transport until command records clearance. Reset/replay clears manual reports and clinical entries. The supplied human model and its CC0 license are included.

Do not merge or replace the root app blindly. Agree on a device/event adapter with the tracking/backend owners before connecting live feeds; keep identity, timestamps, provenance and stale-data handling explicit.
