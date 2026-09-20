# Local development

## Start from the repository root

After the [one-time setup](../README.md#quick-start), use:

```sh
pnpm run dev
```

The launcher starts three separate Next.js processes from the one app at the
repository root, prints labeled logs and opens no external connections beyond
those the app already uses (such as Mapbox). Open the printed links in your
browser:

| Service          | Local URL               | What it opens                                     |
| ---------------- | ----------------------- | ------------------------------------------------- |
| `dispatch`       | <http://localhost:5176> | Command/dispatch workspace                        |
| `officer`        | <http://localhost:5177> | Officer workspace                                 |
| `hospital`       | <http://localhost:5178> | Hospital receiving workspace                      |
| `map` (optional) | <http://localhost:5173> | Every route, unpinned: `/`, `/map` and `/capture` |

Start only the services you need:

```sh
pnpm run dev -- officer
pnpm run dev -- dispatch hospital
pnpm run dev -- dispatch officer hospital map
pnpm run dev -- --help
```

Stop the launcher with Ctrl+C. It owns its children and stops siblings if one
fails. It checks dependencies and selected ports before starting any server. It
does not install packages automatically, kill unrelated processes or select an
unexpected replacement port.

## Where changes belong

```text
scripts/dev.mjs          Local process supervisor and service definitions
app/                     Routes: dashboard at /, /map, /capture, and the API bridges
features/paw-patrol/     Workspace UI, scenario clock and 3D patrol vehicles
features/anatomy/        Officer anatomy viewer used by the hospital handoff
features/boston-map/     Map lifecycle, building layer and building selection
features/live-track/     Traccar position validation, freshness and live map layer
features/camera-triage/  Camera and microphone capture, triage and transcribe clients
services/triage/         Python vision inference service
docs/                    Project setup and integration contracts
```

Dispatch, Officer and Hospital are the same source tree. `PAW_PATROL_WORKSPACE`
selects the fixed workspace, and `PAW_PATROL_DIST_DIR` gives each process its own
generated output so three concurrent servers cannot overwrite one another. Leave
both unset and the app serves every view plus `/map` and `/capture`. Port
separation is for development and does not provide user authorization.

One `package.json`, one lockfile and one `pnpm run verify` cover the whole
repository. The launcher is only a development entry point.

## Configuration and state

`pnpm run setup` creates the ignored environment file without overwriting it:

- `.env.local`: the public Mapbox token, plus optional server-only Traccar and
  triage settings.

Allow `http://localhost:5176/*`, `http://localhost:5177/*`, `http://localhost:5178/*`
and `http://localhost:5173/*` in restricted Mapbox public tokens, plus the
corresponding 127.0.0.1 addresses if you use them. Do not copy server secrets into
public variables: anything prefixed `NEXT_PUBLIC_` ships to the browser.

Each browser owns an independent synthetic scenario. Playback, panic requests,
tactical notes and MIST entries do not propagate between servers, tabs or browsers.
Refresh starts a new demo. For a demonstration with one shared in-memory scenario
and switchable workspaces, stop the launcher and run `pnpm run dev:map`, then use
the workspace tabs at port 5173.

## Real signals

The scenario is simulated; three opt-in signals are not. Live tracking polls
`/api/live-position`, the capture panel posts to `/api/triage` and
`/api/transcribe`, and building selection reads the loaded Mapbox tile. Each
reports what is missing rather than inventing a reading when unconfigured.

The vision service is intentionally separate from frontend startup. Follow its
[runbook](hazard-triage.md) to start the authenticated API and models. The camera
pages at `/capture` and the dashboard's evidence panel both submit frames through
the server-side `/api/triage` bridge when it is configured in `.env.local`.

## Troubleshooting

- **Port already in use:** stop the old dev server in its terminal with Ctrl+C,
  then retry. An old dashboard at 5176 conflicts with Dispatch. Do not stop other
  applications merely to free a port without first identifying them.
- **Dependencies missing:** from the repository root run
  `pnpm install --frozen-lockfile`. The launcher's Node-only code needs no
  installed dependencies of its own.
- **Wrong page:** 5176–5178 each serve one pinned workspace at `/`. Port 5173
  serves every route, including the standalone map at `/map`.
- **Map unavailable:** check the public token in `.env.local`, allowed origins,
  internet access and browser WebGL. The demo UI can still operate without map data.

## Validation

```sh
# Launcher process and port lifecycle tests (no installed app dependencies needed)
pnpm run test:launcher

# Formatting, type checking, lint, tests and a production build
pnpm run verify
```

With all servers running, check each role URL and test Ctrl+C shutdown.
