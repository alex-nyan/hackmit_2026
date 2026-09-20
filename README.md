# Paw Patrol · HackMIT 2026

Start here for the Dispatch, Officer and Hospital workspaces. The repository also
contains the original live fleet map and a separate visual hazard-triage service.
The three workspaces share the dashboard implementation in `apps/paw-patrol`;
each runs as its own local server with its own build output.

## Quick start

Requirements:

- Node.js **26.9.0** (`.nvmrc` selects Node) for the root launcher and map.
- The dashboard lockfile uses **npm 11.6.2**; use the pinned command below.
- **pnpm 12.4.2** only for installing/checking the optional original map.
- Git.
- Your own **Mapbox public access token**, beginning with `pk.`.
- An internet connection and a browser with WebGL support.

```bash
git clone https://github.com/alex-nyan/hackmit_2026.git
cd hackmit_2026
```

With nvm installed, run `nvm install` and `nvm use` inside the repository.
Install the dashboard dependencies once and create local configuration:

```bash
npx --yes npm@11.6.2 ci --prefix apps/paw-patrol
npm run setup
```

Set your public Mapbox token in `apps/paw-patrol/.env.local`:

```dotenv
NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN=your_public_mapbox_token
```

Create a public token at <https://account.mapbox.com/access-tokens/>. Do not use a
secret `sk.` token. If URL restrictions are enabled, allow localhost and 127.0.0.1
on ports **5176, 5177 and 5178**.

Then start all three from the **repository root** with one command:

```bash
npm run dev
```

| Workspace          | Address                 | Source            |
| ------------------ | ----------------------- | ----------------- |
| Dispatch (Command) | <http://localhost:5176> | `apps/paw-patrol` |
| Officer            | <http://localhost:5177> | `apps/paw-patrol` |
| Hospital           | <http://localhost:5178> | `apps/paw-patrol` |

Each server opens its assigned workspace. **Ctrl+C stops all servers started by
the launcher.** An occupied port produces an error; it does not terminate an
unrelated server. Stop an older dashboard on 5176 before starting the launcher.
Run a subset with `npm run dev -- officer hospital`, or see `npm run dev -- --help`.

These are independent, synthetic browser demo sessions. Starting playback or
entering a handoff in one browser does not update another. Port separation selects
the UI; it is not authentication or role authorization. Live feeds and the triage
backend are not automatically connected.

See [the development guide](docs/development.md) for the directory map, individual
commands and troubleshooting. Setup preserves existing local configuration.

## Original map (optional, port 5173)

The root Next.js app retains the interactive 3D building map and live fleet tracking.
Install its dependencies with `pnpm install --frozen-lockfile`, set the public token
in the root `.env.local`, then run `npm run dev:map`. Allow localhost/127.0.0.1 port
5173 in your Mapbox token restrictions too. To run it alongside the workspaces:

```bash
npm run dev -- dispatch officer hospital map
```

The following fleet, map and production instructions refer to this original app.

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
- Isolated map feature modules, TypeScript, tests, and CI checks.

The separate Paw Patrol workspaces use synthetic demonstration data; Traccar
tracking is available in the original map only.

## Production build, locally

Set the token in `.env.local` **before building**, then run:

```bash
pnpm run build
pnpm start
```

Open http://localhost:5173. Stop the development server first because both use
that port. To use another port:

```bash
pnpm run dev:map -- --port 5174
# Or, after a build:
pnpm start -- --port 5174
```

`NEXT_PUBLIC_` values are embedded into the browser bundle at build time. Restart
development after token changes; rebuild production after token changes.

## Commands and quality checks

| Command                          | Purpose                                                       |
| -------------------------------- | ------------------------------------------------------------- |
| `pnpm install --frozen-lockfile` | Reproduce the committed dependency lockfile                   |
| `npm run setup`                  | Create map/dashboard local configuration without overwriting  |
| `npm run dev`                    | Start Dispatch, Officer and Hospital on ports 5176–5178       |
| `npm run dev:map`                | Start the original map at port 5173                           |
| `npm run test:launcher`          | Check startup, port handling and process shutdown             |
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
app/                    Next.js routes, metadata, and shared map styling
apps/paw-patrol/         Shared Dispatch, Officer and Hospital dashboard
scripts/dev.mjs         One-command local server supervisor
services/triage/         Separate Python hazard-triage API
app/api/live-position/  Server-only Traccar bridge; credentials never reach the browser
features/boston-map/    Map lifecycle, camera settings, building layer, and UI
features/live-track/    Position validation, freshness, live map layer, and panel
public/favicon.svg     App icon
scripts/setup.mjs      Cross-platform, non-destructive environment setup
.env.example           Public environment variable names; no real credentials
.editorconfig          Shared editor defaults
.prettierrc.json       Repository formatting rules
.github/workflows/     Reproducible checks for team changes
docs/architecture.md   Extension boundaries and map behavior
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
  `pnpm run dev:map -- --hostname 0.0.0.0`, open the laptop's LAN address, and update
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

## Paw Patrol dashboard (consult update)

The dashboard is in [`apps/paw-patrol`](apps/paw-patrol), on branch
`codex/paw-patrol-dashboard`. It preserves the root tracking app and triage backend;
its demonstration is not yet wired to their live feeds.

The root quick start launches all three workspaces. For the original combined demo
with workspace tabs, run only this app (also uses port 5176, so stop Dispatch first):

```sh
cd apps/paw-patrol
npx --yes npm@11.6.2 ci
npm run setup
# Add your public Mapbox token to .env.local
npm run dev
```

Open <http://localhost:5176>. Run `npm run verify` from that same app directory for
its checks and production build. Do not replace either app's lockfile with the other.

Features include Command, Officer and Hospital views, the supplied interactive human
model, tactical descriptions, panic/acknowledgement, scene-gated EMS staging and MIST
handoff observations. People, readings and coordination are explicitly simulated.
ATAK is planned, not connected. No real dispatch or clinical decisions occur.

Read the [updated team brief (PDF)](docs/paw-patrol/Paw_Patrol_Team_Brief_Updated.pdf)
or [editable Word brief](docs/paw-patrol/Paw_Patrol_Team_Brief_Updated.docx).
For a future Vercel project, select root directory `apps/paw-patrol` and Node 22;
configure the Mapbox public environment variable before building. This branch does
not itself create a hosted deployment.
