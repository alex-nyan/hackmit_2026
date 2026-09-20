# Paw Patrol · HackMIT 2026

Start here for the Dispatch, Officer and Hospital workspaces. One Next.js app at
the repository root serves all three, the standalone Boston map at `/map`, the
phone camera pages under `/capture`, and the server routes that bridge to live
tracking and the hazard-triage service. A workspace is a role the same app is
pinned to, not a separate codebase; each runs as its own local server with its
own build output.

## Quick start

Requirements:

- Node.js **22.23.2** (`.nvmrc` selects Node).
- **pnpm 12.4.2**.
- Git.
- Your own **Mapbox public access token**, beginning with `pk.`.
- An internet connection and a browser with WebGL support.

```bash
git clone https://github.com/alex-nyan/hackmit_2026.git
cd hackmit_2026
```

With nvm installed, run `nvm install` and `nvm use` inside the repository.
Install dependencies once and create local configuration:

```bash
pnpm install --frozen-lockfile
pnpm run setup
```

Set your public Mapbox token in `.env.local`:

```dotenv
NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN=your_public_mapbox_token
```

Create a public token at <https://account.mapbox.com/access-tokens/>. Do not use a
secret `sk.` token. If URL restrictions are enabled, allow localhost and 127.0.0.1
on ports **5176, 5177, 5178** and **5173**.

Then start all three from the **repository root** with one command:

```bash
pnpm run dev
```

| Workspace          | Address                 | `PAW_PATROL_WORKSPACE` |
| ------------------ | ----------------------- | ---------------------- |
| Dispatch (Command) | <http://localhost:5176> | `dispatch`             |
| Officer            | <http://localhost:5177> | `officer`              |
| Hospital           | <http://localhost:5178> | `hospital`             |

Each server opens its assigned workspace. **Ctrl+C stops all servers started by
the launcher.** An occupied port produces an error; it does not terminate an
unrelated server. Stop an older dashboard on 5176 before starting the launcher.
Run a subset with `pnpm run dev -- officer hospital`, or see `pnpm run dev -- --help`.

These are independent, synthetic browser demo sessions. Starting playback or
entering a handoff in one browser does not update another. Port separation selects
the UI; it is not authentication or role authorization.

See [the development guide](docs/development.md) for the directory map, individual
commands and troubleshooting. Setup preserves existing local configuration.

## Every route (port 5173)

`pnpm run dev:map` starts the same app with no workspace pinned, so every route is
reachable in one place:

| Route            | What it is                                                       |
| ---------------- | ---------------------------------------------------------------- |
| `/`              | The dashboard with switchable Command, Officer and Hospital tabs |
| `/map`           | The standalone 3D building map with live fleet tracking          |
| `/capture`       | The phone-oriented camera page for hazard triage                 |
| `/capture/check` | Whether this device will provide camera and microphone           |

To run it alongside the pinned workspaces:

```bash
pnpm run dev -- dispatch officer hospital map
```

## Real signals on the dashboard map

The scenario clock and its patrol vehicles are simulated throughout. Three
controls bring real data onto the same map, and each is opt-in — nothing is
requested until you turn it on:

- **Live tracking** (the signal icon beside the map theme toggle) polls
  `/api/live-position` and draws real tracked units over the scripted ones. The
  unit list reports each fix's age and accuracy; clicking one flies the camera
  to it. Colour follows freshness, so a stale position is never shown as current.
- **Building selection**: clicking a building that no patrol vehicle covers
  reports the height and footprint the map tile actually carries.
- **Camera and audio evidence**: the Camera and Audio buttons in the Command view
  open a live capture panel that sends frames to `/api/triage` and clips to
  `/api/transcribe`. The scripted weapon and concern events in the timeline stay
  what they always were — demo signals — and the panel says so.

Live tracking and triage each need their own configuration, below. Without it the
panels say what is missing rather than inventing a reading.

## Live fleet tracking (optional)

The locate button in the header shows every unit reporting to a shared
[Traccar](https://www.traccar.org) server, so a team can see each other on one
map. Leave the settings blank and the dashboard runs exactly as before; the button
then explains what is missing instead of failing.

Add to `.env.local`:

```dotenv
TRACCAR_URL=http://localhost:8082
TRACCAR_EMAIL=you@example.com
TRACCAR_PASSWORD=your_traccar_password
TRACCAR_DEVICE_IDS=
```

Leave `TRACCAR_DEVICE_IDS` blank to show every device the account can see — that
is what you want for a shared map. Set it to a comma-separated list of Traccar
numeric device ids (`1,2,5`) to restrict the view. The older single-device
`TRACCAR_DEVICE_ID` still works.

These are read on the server only. **Never prefix them with `NEXT_PUBLIC_`** — that
would send your Traccar password to every visitor's browser.

### Enrolling another device

One device slot per person. For each:

1. In Traccar's web UI press **+**, give the unit a name, and set a device
   identifier you choose (`unit-07`). Or from the command line:

   ```bash
   curl -u "$TRACCAR_EMAIL:$TRACCAR_PASSWORD" \
     -X POST "$TRACCAR_URL/api/devices" \
     -H 'Content-Type: application/json' \
     -d '{"name":"Unit 07","uniqueId":"unit-07"}'
   ```

2. Install **Traccar Client** on that phone and set:
   - **Device identifier** — the identifier from step 1, exactly
   - **Server URL** — `http://YOUR_SERVER:5055`
   - **Accuracy** high, **Distance** 10–20 m
3. Turn **Service status** on and allow **Always** location.

The new unit appears on the map and in the roster on the next poll; no redeploy is
needed. Picking a unit in the roster centres the map on it.

Every phone must be able to reach port `5055` on the server. On one LAN that is the
machine's address; for phones on cellular the server needs a publicly reachable
address, since a laptop behind NAT is not addressable from outside.

### What the colours mean

A unit is green only when its phone reported within the last 90 seconds. Amber is
up to 10 minutes old and grey is older — those mark **where a unit was last seen,
not where it is now**. The distinction is not cosmetic: the Traccar phone app
buffers fixes while it has no signal and flushes them later, so a position can
arrive long after it was recorded. Freshness is measured from the phone's own fix
time, never from when the server received it.

Traccar's own "online" flag means data arrived recently, which is not the same as
a fresh fix; the roster reports the two separately.

Tracking is off until you press the button, only the latest fix per unit is held,
and no location history is kept by the dashboard.

## Camera hazard triage (optional)

Start the app with `pnpm run dev:map`, then open
<http://localhost:5173/capture> for the phone-oriented camera page. It sends frames
to the hazard triage service in `services/triage`; it is separate from the three
demo workspaces on ports 5176–5178. Add to the root `.env.local`:

```dotenv
TRIAGE_URL=http://127.0.0.1:8090
TRIAGE_API_TOKEN=your_triage_bearer_token
TRIAGE_TIMEOUT_SECONDS=240
```

Server-side only. **Never prefix these with `NEXT_PUBLIC_`** — the bearer token
would otherwise reach every visitor. The browser posts to `/api/triage`, which
attaches the token and forwards to `/v1/triage`.

The timeout covers the service's default inference deadlines plus overhead.
Increase it if the service uses a longer provider timeout (maximum 3600 seconds).
The dashboard has no user login: anyone who can reach `/api/triage` or
`/api/transcribe` can submit media using the configured service credential.
Keep this demo on a trusted LAN,
or put authenticated access in front of the dashboard before exposing it publicly.

### Using an iPhone as the camera

macOS Continuity Camera exposes a nearby iPhone as an ordinary capture device,
which sidesteps the HTTPS problem entirely: the browser runs on the Mac at
`localhost`, and the phone is merely the lens. Both devices must be signed into
the same Apple Account with two-factor, with Wi-Fi and Bluetooth on; a USB cable
is the most reliable connection. The camera pickers preselect an iPhone or iPad
when one appears, and the list refreshes on `devicechange` because a Continuity
Camera comes and goes as the phone becomes eligible.

`/capture/check` tests capture alone, with **no network calls at all**, so a
device problem cannot be confused with a service problem. It reports the origin,
whether the page is in a secure context, which devices were granted, what
formats the browser can record, and it plays a short clip back locally.

### Camera access needs HTTPS

Browsers expose `getUserMedia` only in a secure context. `localhost` is exempt,
so development works over plain HTTP on the machine itself, but a phone on the
LAN needs real HTTPS:

```bash
pnpm exec next dev --experimental-https
```

The first run downloads mkcert and installs a local certificate authority, which
**prompts for your password**. On iOS, also install that CA on the device and
enable full trust under Settings → General → About → Certificate Trust Settings;
without that second step Safari still refuses the camera.

### Audio transcription

The page can also record ten-second audio clips and send them to
`/v1/transcribe`. It is **off by default on the service**; enable it and install
the optional dependency:

```bash
cd services/triage
uv sync --locked --extra yolo --extra whisper
TRIAGE_TRANSCRIPTION_ENABLED=true uv run --no-sync uvicorn triage.app:create_app --factory \
  --host 127.0.0.1 --port 8090 --workers 1 --no-access-log
```

`TRIAGE_WHISPER_MODEL` defaults to `base` on CPU with `int8`. The service starts
and serves triage normally without the dependency, reporting transcription as
unavailable rather than failing.

Keep `--extra yolo` when adding Whisper to the existing camera service so syncing
does not remove its detector dependencies. For a deployment with YOLO disabled,
`--extra whisper` alone is sufficient. Whisper loads on first use and may download
the configured model; set `TRIAGE_WHISPER_MODEL` to a provisioned local model
directory to avoid that first-request download.

The page prefers `audio/mp4` when the browser supports it, then falls back to
WebM or Ogg. Each ten-second recording is finalized as a complete file before
upload; clips are dropped while an earlier upload is in flight. Stop and
backgrounding release the microphone and cancel pending uploads.

`TRIAGE_TIMEOUT_SECONDS` in the dashboard environment also controls the
transcription proxy's timeout; increase it for slower local models.

A transcript is a model hypothesis, not a record of speech. Empty text means
nothing was recognised, which is **not** the same as nothing having been said —
the payload carries `transcript_semantics` and `requires_human_review` so a
caller cannot quietly treat it as evidence.

### What it does and does not do

Frames go out one at a time. The service admits a single frame concurrently and
answers `429` when busy, so the page waits for each response before capturing
again rather than queueing frames until they age out.

The service never reports a scene as safe: `status` is only ever `needs_review`
or `insufficient_evidence`, and `requires_human_review` is always true. Treat the
output as a prompt for a person, and the confidence values as uncalibrated model
scores rather than probabilities.

**iOS suspends camera and microphone capture when the tab is backgrounded or the
screen locks.** A browser page cannot keep recording from a pocket; it needs to
stay in the foreground. Only a native app can do otherwise.

## What is included

- Real vector basemaps: Mapbox `light-v11` and `dark-v11`.
- Real 3D building heights from `composite` → `building` → `fill-extrusion`,
  with ambient occlusion and bevelled edges for depth.
- Click any building for its real height, base, and footprint area.
- MIT, Harvard, Boston, and All Boston camera presets.
- Theme toggle, zoom, compass/pitch, fullscreen, keyboard and touch navigation.
- Responsive layout, loading feedback, missing-token and failed-load states.
- Optional live fleet tracking from a Traccar server: every unit on one map,
  opt-in and server-authenticated.
- Optional camera hazard triage and audio transcription, on the dashboard and at
  `/capture`, proxied so the service token stays on the server.
- Works with an iPhone over Continuity Camera, or any built-in camera.
- Isolated map feature modules, TypeScript, tests, and CI checks.

The scenario the workspaces play back is synthetic. Traccar tracking, building
facts and camera triage are the real signals, and each is opt-in on both the
dashboard map and `/map`.

## Production build, locally

Set the token in `.env.local` **before building**, then run:

```bash
pnpm run build
pnpm start
```

Open <http://localhost:5176>. Stop the development server first because both use
that port. To use another port:

```bash
pnpm start -- --port 5179
```

`pnpm start` serves every route. Pin a role by setting `PAW_PATROL_WORKSPACE`
before `pnpm run build` and `pnpm start`.

`NEXT_PUBLIC_` values are embedded into the browser bundle at build time. Restart
development after token changes; rebuild production after token changes.

## Commands and quality checks

| Command                          | Purpose                                                       |
| -------------------------------- | ------------------------------------------------------------- |
| `pnpm install --frozen-lockfile` | Reproduce the committed dependency lockfile                   |
| `pnpm run setup`                 | Create local configuration without overwriting                |
| `pnpm run dev`                   | Start Dispatch, Officer and Hospital on ports 5176–5178       |
| `pnpm run dev:map`               | Start every route, unpinned, at port 5173                     |
| `pnpm run test:launcher`         | Check startup, port handling and process shutdown             |
| `pnpm run format`                | Format supported source and configuration files with Prettier |
| `pnpm run format:check`          | Verify formatting without changing files                      |
| `pnpm run check`                 | Check formatting, types, lint, and tests                      |
| `pnpm run verify`                | Run all checks and a production build                         |
| `pnpm run build`                 | Produce a Next.js production build                            |
| `pnpm start`                     | Serve the production build locally                            |
| `pnpm run test:watch`            | Run tests during development                                  |

GitHub Actions runs installation, checks, and a production build on Linux and
Windows using the same pinned Node/pnpm versions. CI does not need a real token:
tests isolate Mapbox, and the application
shows a setup message when a token is absent. A successful build without a token
does **not** mean the live map has been verified.

## Project layout

```text
app/                     Next.js routes: dashboard, /map, /capture, and the API bridges
app/api/live-position/   Server-only Traccar bridge; credentials never reach the browser
app/api/triage/          Server-only bridge to the hazard-triage service
app/api/transcribe/      Server-only bridge to audio transcription
features/paw-patrol/     Workspace UI, scenario clock, and 3D patrol vehicles
features/anatomy/        Officer anatomy viewer used by the hospital handoff
features/boston-map/     Map lifecycle, camera settings, building layer, and selection
features/live-track/     Position validation, freshness, live map layer, and panel
features/camera-triage/  Camera and microphone capture, and the triage/transcribe clients
services/triage/         Separate Python hazard-triage API
scripts/dev.mjs          One-command local server supervisor
scripts/setup.mjs        Cross-platform, non-destructive environment setup
public/models/           Officer body mesh for the anatomy viewer
tsconfig.<workspace>.json  One TypeScript project per pinned role
.env.example             Public environment variable names; no real credentials
.github/workflows/       Reproducible checks for team changes
docs/architecture.md     Extension boundaries and map behavior
docs/paw-patrol/         Dashboard architecture, route provenance, and verification notes
```

## Troubleshooting

- **Token required:** run `pnpm run setup`, enter a public token in `.env.local`,
  then restart. `.env.example` alone is not loaded as your local configuration.
- **401/403 or blank map:** check token validity, URL restrictions, network access
  to Mapbox, browser extensions, and Mapbox account availability.
- **Flat at All Boston:** intentional. Extrusions begin at zoom **15** and reach
  their stored heights at **15.05**. Click MIT/Harvard/Boston or zoom in and tilt.
- **Some buildings are missing/box-shaped:** geometry comes from Mapbox's data.
  This is vector extrusion, not photogrammetry or detailed architectural models.
- **Port already in use:** stop the other server or use `--port 5174`.
- **pnpm cache / permissions:** use pnpm's configured store and do not install
  project dependencies with `sudo`.
- **WebGL unavailable:** enable hardware acceleration or use a WebGL-capable browser.
- **Phone access:** `localhost` on a phone points to the phone, not your laptop.
  The default server binds to loopback. For a trusted LAN only, explicitly use
  `pnpm exec next dev --hostname 0.0.0.0`, open the laptop's LAN address, and update
  token URL restrictions. Phone positions come from Traccar (see **Live fleet
  tracking**), not from the browser's geolocation API.

- **The locate button says tracking is not configured.** `TRACCAR_URL`,
  `TRACCAR_EMAIL` and `TRACCAR_PASSWORD` must all be set in `.env.local`, and the
  server restarted afterwards.
- **A unit is grey or amber, not green.** That is the fix age, not a fault. That
  phone has not sent a recent position — check that Traccar Client's service is on,
  that it can reach port 5055, and that the person is outdoors.
- **A unit is missing from the roster.** The device must exist in Traccar and be
  visible to the account in `TRACCAR_EMAIL`. If `TRACCAR_DEVICE_IDS` is set, the
  unit's numeric id must be in it.
- **The device shows online but the fix is old.** Traccar's online flag means data
  arrived recently, not that the GPS fix is fresh. The panel reports both.

## Credentials and hosting

Never commit `.env.local`, real tokens, GPS data, or passwords. Mapbox **public**
tokens are necessarily visible in browser requests; use a dedicated token with
appropriate permissions and URL restrictions. Other service credentials belong
on the server and must never use a `NEXT_PUBLIC_` variable.

The repository is ready for a standard Next.js host. For a future Vercel deployment,
select Next.js and configure `NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN` before building.
Add the deployed domain to your token's allowed URLs. No hosted deployment is
created by these local setup instructions.

See [architecture](docs/architecture.md) and [contributing](CONTRIBUTING.md).

## Visual hazard triage infrastructure

The separate [hazard-triage service](docs/hazard-triage.md) combines YOLO26 object
evidence with local Ollama `gemma4:26b` and an optional OpenAI-compatible vision API.
It includes an authenticated API, bounded inference, validated confidence and
evidence contracts, durable retry handling, and mandatory human review. The map
remains independently runnable. See the runbook for setup, the Mermaid architecture,
testing, and the remaining production integration requirements.

## Paw Patrol dashboard

The dashboard lives in [`features/paw-patrol`](features/paw-patrol) and is served
at `/`. It is the same app as the tracking map and the triage bridges, so its map
can show real tracked units, real building facts and real camera triage alongside
the scripted scenario — see **Real signals on the dashboard map** above.

The quick start launches all three pinned workspaces. For the combined demo with
switchable workspace tabs, start the unpinned server instead:

```sh
pnpm run dev:map
```

Open <http://localhost:5173>. `pnpm run verify` runs every check and a production
build for the whole repository.

Features include Command, Officer and Hospital views, the supplied interactive human
model, tactical descriptions, panic/acknowledgement, scene-gated EMS staging and MIST
handoff observations. People, vital readings and coordination are explicitly simulated.
ATAK is planned, not connected. No real dispatch or clinical decisions occur.

Read the [updated team brief (PDF)](docs/paw-patrol/Paw_Patrol_Team_Brief_Updated.pdf)
or [editable Word brief](docs/paw-patrol/Paw_Patrol_Team_Brief_Updated.docx).
For a future Vercel project, select the repository root and Node 22; configure the
Mapbox public environment variable before building. This branch does not itself
create a hosted deployment.
