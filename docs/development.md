# Local development

## Start from the repository root

After the [one-time setup](../README.md#quick-start), use:

```sh
npm run dev
```

The launcher starts three separate Next.js processes, prints labeled logs and
opens no external connections beyond those already used by the apps (such as
Mapbox). Open the printed links in your browser:

| Service          | Local URL               | What it opens                              |
| ---------------- | ----------------------- | ------------------------------------------ |
| `dispatch`       | <http://localhost:5176> | Command/dispatch workspace                 |
| `officer`        | <http://localhost:5177> | Officer workspace                          |
| `hospital`       | <http://localhost:5178> | Hospital receiving workspace               |
| `map` (optional) | <http://localhost:5173> | Original map and optional Traccar tracking |

Start only the services you need:

```sh
npm run dev -- officer
npm run dev -- dispatch hospital
npm run dev -- dispatch officer hospital map
npm run dev -- --help
```

Stop the launcher with Ctrl+C. It owns its children and stops siblings if one
fails. It checks dependencies and selected ports before starting any server. It
does not install packages automatically, kill unrelated processes or select an
unexpected replacement port.

## Where changes belong

```text
scripts/dev.mjs                 Local process supervisor and service definitions
apps/paw-patrol/app/            Dashboard entry point and layout
apps/paw-patrol/features/       Shared workspace UI, scenario and rendering
app/ + features/               Original map and live fleet tracking
services/triage/                Python vision inference service
docs/                          Project setup and integration contracts
```

Dispatch, Officer and Hospital reuse the same source tree. Server configuration
selects the initial, fixed workspace, and each process has separate generated
output. This keeps scenario and UI fixes shared without three copied applications.
Port separation is for development and does not provide user authorization.

The original map remains at the repository root to preserve existing imports,
tooling and deployment configuration. Its `build`, `start` and `verify` commands
continue to target the original map. Dashboard checks and production commands run
inside `apps/paw-patrol`; the launcher is only a development entry point.

## Configuration and state

`npm run setup` creates both ignored environment files without overwriting them:

- `apps/paw-patrol/.env.local`: public Mapbox token used by all three workspaces.
- `.env.local`: original map token and optional server-only Traccar settings.

Allow `http://localhost:5176/*`, `http://localhost:5177/*`, and
`http://localhost:5178/*` in restricted Mapbox public tokens, plus the corresponding
127.0.0.1 addresses if you use them. Do not copy server secrets into public variables.

Each browser owns an independent synthetic scenario. Playback, panic requests,
tactical notes and MIST entries do not propagate between servers, tabs or browsers.
Refresh starts a new demo. For a demonstration with one shared in-memory scenario
and switchable workspaces, stop the launcher and run `npm run dev` from
`apps/paw-patrol`, then use its workspace tabs at port 5176.

The vision service is intentionally separate from frontend startup. Follow its
[runbook](hazard-triage.md) to start the authenticated API and models; the dashboard
does not yet consume its results or initiate real dispatch.

## Troubleshooting

- **Port already in use:** stop the old dev server in its terminal with Ctrl+C,
  then retry. An old dashboard at 5176 conflicts with Dispatch. Do not stop other
  applications merely to free a port without first identifying them.
- **Dashboard dependencies missing:** from the repository root run
  `npx --yes npm@11.6.2 ci --prefix apps/paw-patrol`. This uses its committed npm
  lockfile. The launcher's Node-only code needs no root dependency installation.
- **Original map dependencies missing:** run `pnpm install --frozen-lockfile`
  at the repository root before selecting `map`.
- **Wrong page:** port 5173 is the original map; 5176–5178 are the three workspaces.
  Each dedicated workspace is served at `/`, not a hidden route on port 5173.
- **Map unavailable:** check the public token in the correct app's environment
  file, allowed origins, internet access and browser WebGL. The demo UI can still
  operate without map data.

## Validation

```sh
# Launcher process and port lifecycle tests (no installed app dependencies needed)
npm run test:launcher

# Dashboard type checking, lint, tests and production build
cd apps/paw-patrol
npm run verify
```

With all servers running, check each role URL and test Ctrl+C shutdown. The root
map retains its separate `pnpm run verify` checks.
