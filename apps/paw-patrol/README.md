# Paw Patrol

HackMIT desktop demonstration of coordinated officer safety and hospital handoff.
Command, Officer and Hospital share one deterministic 90-second frontend simulation.

**Every person, heart-rate value, detection event, route and response is synthetic.**
No camera, microphone, watch or GPS device is connected. Nothing dispatches real responders,
contacts hospitals, diagnoses injuries or stores personal data.

## Run locally

For three separate servers, use **`npm run dev` from the repository root** after
the [root quick start](../../README.md#quick-start): Dispatch at 5176, Officer at
5177, Hospital at 5178. Each opens its own workspace and has an independent browser
demo session. See [local development](../../docs/development.md) for service
selection, configuration and process shutdown.

For the combined, switchable-workspace demo in one browser, follow the steps below.
It uses the same port as Dispatch, so stop the root launcher first.

Use Node 22.23.2 (`.nvmrc`) and npm 11.6.2. From this directory:

```sh
npm ci
npm run setup
```

Put your Mapbox public `pk.` token in the generated, ignored `.env.local`:

```dotenv
NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN=your_public_token
```

Allow `http://localhost:5176/*` and `http://127.0.0.1:5176/*` in your token restrictions.
Also allow ports 5177 and 5178 when using the root launcher.
Then `npm run dev` and open [localhost:5176](http://localhost:5176).
The body model is included locally; the real 3D basemap needs internet, WebGL and a valid token.
The rest of the demonstration remains usable if the map is unavailable.

## Demonstration

Run demo starts a 90-second automatic sequence. Pause/Resume, Reset and Next stage
are presenter controls, not real dispatch approvals. Changing workspaces does not reset playback.
Switching away from the browser pauses the demo; resume explicitly on return.

| Time | Scripted event |
| --- | --- |
| 0s | Four fictional officers on patrol |
| 15s | Unverified possible weapon signal |
| 22s | Sample audio concern |
| 30s | P-02 and P-03 assigned to support P-01 |
| 45s | Explicit staged injury report, not inferred from pulse |
| 52s | Simulated medical response assigned |
| 56s | Separate scripted command clearance report |
| 60s | Simulated transport |
| 75s | Handoff visible to receiving desk |
| 90s | Handoff complete; playback stops |

The supplied human model appears in Officer and Hospital. Drag/arrow keys rotate;
wheel, pinch, buttons or +/- zoom; Home/Reset restores full-body framing.
Front, Side and Back presets are available. It is a generic model, not a scan.
Injury notes are textual and only associated with the correct scripted person;
body regions are not mapped or presented as medically identified.

## Checks and production

```sh
npm run verify
npm start
```

Stop development before using production on the same port. A different port can be selected
with `npm run dev -- --port 5177`. Do not use the original map repo's ports 5173/5174.

This is the shared `apps/paw-patrol` dashboard in `alex-nyan/hackmit_2026`,
branch `codex/paw-patrol-dashboard`. The original map and triage backend are separate.
Run dashboard build/check commands here; run the multi-server launcher at the root.
For Vercel, select `apps/paw-patrol` as the root directory, Node 22, and configure `NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN`
before building; permit the deployed domain in Mapbox. Public tokens are embedded at build time.
Do not upload private device data or server secrets. No hosted deployment has been created.

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
