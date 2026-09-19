# GridLens · HackMIT 2026

A full-screen, interactive 3D building map of MIT, Harvard, Cambridge, and Boston.
This repository preserves the working local map's appearance, camera presets,
light/dark themes, and real Mapbox building extrusions.

The foundation is **Next.js App Router + React + TypeScript + Mapbox GL JS**.
It runs with normal Node/npm commands: no Codex, Sites plugin, Cloudflare account,
database, or platform-specific tooling is needed.

## Quick start

Requirements:

- Node.js **22.13+** (Node 22 LTS is recommended; `.nvmrc` selects it).
- npm and Git.
- Your own **Mapbox public access token**, beginning with `pk.`.
- An internet connection and a browser with WebGL support.

```bash
git clone --branch codex/boston-map-foundation https://github.com/alex-nyan/hackmit_2026.git
cd hackmit_2026
npm ci
npm run setup
```

The command selects the map feature branch. Once it is merged into `main`, the
`--branch codex/boston-map-foundation` option can be omitted.

Edit the newly created `.env.local`:

```dotenv
NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN=your_public_mapbox_token
```

Create a public token at <https://account.mapbox.com/access-tokens/>. Do not use a
secret `sk.` token. If URL restrictions are enabled, allow `http://localhost:5173/*`
(and `http://127.0.0.1:5173/*` if you use that address).

```bash
npm run dev
```

Open **http://localhost:5173**. The initial view is MIT, tilted to show building
heights. The setup script works on macOS, Windows, and Linux, and **never overwrites
an existing `.env.local`**. Mapbox serves the remote map data; its account limits
and pricing still apply.

## What is included

- Real vector basemaps: Mapbox `light-v11` and `dark-v11`.
- Real 3D building heights from `composite` → `building` → `fill-extrusion`.
- MIT, Harvard, Boston, and All Boston camera presets.
- Theme toggle, zoom, compass/pitch, fullscreen, keyboard and touch navigation.
- Responsive layout, loading feedback, missing-token and failed-load states.
- Isolated map feature modules, TypeScript, tests, and CI checks.

There are intentionally **no energy overlays, mock metrics, heatmap circles,
dashboards, or live GPS integrations**. Traccar/phone tracking is a separate future
integration; adding a device in Traccar does not connect it to this app.

## Production build, locally

Set the token in `.env.local` **before building**, then run:

```bash
npm run build
npm start
```

Open http://localhost:5173. Stop the development server first because both use
that port. To use another port:

```bash
npm run dev -- --port 5174
# Or, after a build:
npm start -- --port 5174
```

`NEXT_PUBLIC_` values are embedded into the browser bundle at build time. Restart
development after token changes; rebuild production after token changes.

## Commands and quality checks

| Command | Purpose |
| --- | --- |
| `npm ci` | Reproduce the committed dependency lockfile |
| `npm run setup` | Create `.env.local` safely from the tracked example |
| `npm run dev` | Start local development at port 5173 |
| `npm run check` | Typecheck, lint, and run tests |
| `npm run verify` | Run all checks and a production build |
| `npm run build` | Produce a Next.js production build |
| `npm start` | Serve the production build locally |
| `npm run test:watch` | Run tests during development |

GitHub Actions runs installation, checks, and a production build on Linux and
Windows. CI does not need a real token: tests isolate Mapbox, and the application
shows a setup message when a token is absent. A successful build without a token
does **not** mean the live map has been verified.

## Project layout

```text
app/                    Next.js route, metadata, and shared map styling
features/boston-map/    Map lifecycle, camera settings, building layer, and UI
public/favicon.svg     Original GridLens icon
scripts/setup.mjs      Cross-platform, non-destructive environment setup
.env.example           Public environment variable names; no real credentials
.github/workflows/     Reproducible checks for team changes
docs/architecture.md   Extension boundaries and map behavior
```

## Troubleshooting

- **Token required:** run `npm run setup`, enter a public token in `.env.local`,
  then restart. `.env.example` alone is not loaded as your local configuration.
- **401/403 or blank map:** check token validity, URL restrictions, network access
  to Mapbox, browser extensions, and Mapbox account availability.
- **Flat at All Boston:** intentional. Extrusions begin at zoom **15** and reach
  their stored heights at **15.05**. Click MIT/Harvard/Boston or zoom in and tilt.
- **Some buildings are missing/box-shaped:** geometry comes from Mapbox's data.
  This is vector extrusion, not photogrammetry or detailed architectural models.
- **Port already in use:** stop the other server or use `--port 5174`.
- **WebGL unavailable:** enable hardware acceleration or use a WebGL-capable browser.
- **Phone access:** `localhost` on a phone points to the phone, not your laptop.
  The default server binds to loopback. For a trusted LAN only, explicitly use
  `npm run dev -- --hostname 0.0.0.0`, open the laptop's LAN address, and update
  token URL restrictions. This does not implement GPS or background tracking.

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
