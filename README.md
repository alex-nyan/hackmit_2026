# Paw Patrol · HackMIT 2026

A full-screen, interactive 3D building map of MIT, Harvard, Cambridge, and Boston.
This repository preserves the working local map's appearance, camera presets,
light/dark themes, and real Mapbox building extrusions.

The foundation is **Next.js App Router + React + TypeScript + Mapbox GL JS**.
It runs with normal Node/pnpm commands: no Codex, Sites plugin, Cloudflare account,
database, or platform-specific tooling is needed.

## Quick start

Requirements:

- Node.js **26.9.0** and pnpm **12.4.2** are the tested toolchain (`.nvmrc` selects Node).
- Git.
- Your own **Mapbox public access token**, beginning with `pk.`.
- An internet connection and a browser with WebGL support.

```bash
git clone https://github.com/alex-nyan/hackmit_2026.git
cd hackmit_2026
```

The command clones the default `main` branch. Check `node --version` and
`pnpm --version` before installing. With nvm installed, run `nvm install` and
`nvm use` inside the repository. If pnpm is not available, enable the pinned
package manager with your Node toolchain or install pnpm 12.4.2.

Then install the dependencies and create your local configuration:

```bash
pnpm install --frozen-lockfile
pnpm run setup
```

Edit the newly created `.env.local`:

```dotenv
NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN=your_public_mapbox_token
```

Create a public token at <https://account.mapbox.com/access-tokens/>. Do not use a
secret `sk.` token. If URL restrictions are enabled, allow `http://localhost:5173/*`
(and `http://127.0.0.1:5173/*` if you use that address).

```bash
pnpm run dev
```

Open **http://localhost:5173**. The initial view is MIT, tilted to show building
heights. The setup script works on macOS, Windows, and Linux, and **never overwrites
an existing `.env.local`**. Mapbox serves the remote map data; its account limits
and pricing still apply.

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

`/capture` opens a phone-oriented page that sends camera frames to the hazard
triage service in `services/triage`. Add to `.env.local`:

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
The dashboard has no user login: anyone who can reach `/api/triage` can submit a
frame using the configured service credential. Keep this demo on a trusted LAN,
or put authenticated access in front of the dashboard before exposing it publicly.

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

### What it does and does not do

Frames go out one at a time. The service admits a single frame concurrently and
answers `429` when busy, so the page waits for each response before capturing
again rather than queueing frames until they age out.

The service never reports a scene as safe: `status` is only ever `needs_review`
or `insufficient_evidence`, and `requires_human_review` is always true. Treat the
output as a prompt for a person, and the confidence values as uncalibrated model
scores rather than probabilities.

**iOS suspends camera capture when the tab is backgrounded or the screen locks.**
A browser page cannot keep recording from a pocket; it needs to stay in the
foreground.

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
- Optional camera hazard triage at `/capture`, proxied so the service token
  stays on the server.
- Isolated map feature modules, TypeScript, tests, and CI checks.

There are intentionally **no energy overlays, mock metrics, heatmap circles,
dashboards, or live GPS integrations**. Traccar/phone tracking is a separate future
integration; adding a device in Traccar does not connect it to this app.

## Production build, locally

Set the token in `.env.local` **before building**, then run:

```bash
pnpm run build
pnpm start
```

Open http://localhost:5173. Stop the development server first because both use
that port. To use another port:

```bash
pnpm run dev -- --port 5174
# Or, after a build:
pnpm start -- --port 5174
```

`NEXT_PUBLIC_` values are embedded into the browser bundle at build time. Restart
development after token changes; rebuild production after token changes.

## Commands and quality checks

| Command                          | Purpose                                                       |
| -------------------------------- | ------------------------------------------------------------- |
| `pnpm install --frozen-lockfile` | Reproduce the committed dependency lockfile                   |
| `pnpm run setup`                 | Create `.env.local` safely from the tracked example           |
| `pnpm run dev`                   | Start local development at port 5173                          |
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
  `pnpm run dev -- --hostname 0.0.0.0`, open the laptop's LAN address, and update
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
