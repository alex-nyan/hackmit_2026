# Paw Patrol

HackMIT desktop demonstration of coordinated officer safety and hospital handoff.
Command, Officer and Hospital share one deterministic 90-second frontend simulation.

**Every person, heart-rate value, detection event, route and response in the 90-second
scenario is synthetic.** Nothing in it dispatches real responders, contacts hospitals,
diagnoses injuries or stores personal data. The map's opt-in live tracking, building
selection and camera triage are separate, real signals — see
[real signals on the dashboard map](../../README.md#real-signals-on-the-dashboard-map).

## Run locally

The dashboard is served at `/` by the app at the repository root; it is no longer a
separate package. After the [root quick start](../../README.md#quick-start):

```sh
pnpm run dev
```

Dispatch at 5176, Officer at 5177, Hospital at 5178 — each pinned to its own
workspace with an independent browser demo session. Allow those ports, plus 5173,
in your Mapbox token restrictions. See [local development](../development.md) for
service selection, configuration and process shutdown.

For the combined, switchable-workspace demo in one browser, run `pnpm run dev:map`
and open [localhost:5173](http://localhost:5173).

The body model is included locally; the real 3D basemap needs internet, WebGL and a
valid token. The rest of the demonstration remains usable if the map is unavailable.

## Demonstration

Run demo starts a 90-second automatic sequence. Pause/Resume, Reset and Next stage
are presenter controls, not real dispatch approvals. Changing workspaces does not reset playback.
Switching away from the browser pauses the demo; resume explicitly on return.

| Time | Scripted event                                         |
| ---- | ------------------------------------------------------ |
| 0s   | Four fictional officers on patrol                      |
| 15s  | Unverified possible weapon signal                      |
| 22s  | Sample audio concern                                   |
| 30s  | P-02 and P-03 assigned to support P-01                 |
| 45s  | Explicit staged injury report, not inferred from pulse |
| 52s  | Simulated medical response assigned                    |
| 56s  | Separate scripted command clearance report             |
| 60s  | Simulated transport                                    |
| 75s  | Handoff visible to receiving desk                      |
| 90s  | Handoff complete; playback stops                       |

The supplied human model appears in Officer and Hospital. Drag/arrow keys rotate;
wheel, pinch, buttons or +/- zoom; Home/Reset restores full-body framing.
Front, Side and Back presets are available. It is a generic model, not a scan.
Injury notes are textual and only associated with the correct scripted person;
body regions are not mapped or presented as medically identified.

## Checks and production

```sh
pnpm run verify
pnpm start
```

`pnpm run verify` covers the whole repository: formatting, types, lint, tests and a
production build. Stop development before using production on the same port; select
another with `pnpm start -- --port 5179`.

For Vercel, select the repository root, Node 22, and configure
`NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN` before building; permit the deployed domain in
Mapbox. Public tokens are embedded at build time. Do not upload private device data
or server secrets. No hosted deployment has been created.

## Consult workflow

Command includes a persistent-in-session subject description (clothing, visible items,
last observation and source notes). The observed subject is not the selected officer.
Panic creates a person-specific assistance request and pauses the demo. Acknowledgement
does not establish scene safety or injury.

EMS stages until a separate clearance report. The default sequence has an explicitly
scripted clearance at 56 seconds. A manual unsafe/unknown report overrides that script
and holds the clock before transport at 60 seconds. Command must record clearance,
then resume/advance. Once transport begins, scene changes/panic are disabled for this run.

Hospital shows MIST for P-01 only after the explicit injury event: Mechanism, Injuries,
Signs/symptoms, Treatments/interventions. BP, pulse and AVPU start unknown; manual demo
entries are validated and never inferred from heart rate. Copy MIST creates a local
clipboard summary, not a hospital transmission. Reset/replay clears these entries.
ATAK remains a future native-plugin/adapter integration, not an active connection.

## Structure

- `features/paw-patrol/`: shared scenario, playback, workspaces and operations map.
- `features/anatomy/`: GLB loading, camera controls and GPU cleanup.
- `features/boston-map/`: preserved reusable 3D-building foundation and its tests.
- `public/models/`: actual supplied Blender model exported to GLB.
- `docs/architecture.md`: boundaries and extension notes.
- `public/models/LICENSE.md`: source, licence and export details.

The supplied HackMIT design system informs the indigo, cream and gold palette, serif
headings and rounded controls. Operational labels use a sans-serif for readability;
focus colors are adjusted for contrast. No promotional reference artwork is repurposed.
