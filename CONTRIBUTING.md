# Contributing

1. Follow the README quick start, using the pinned Node/pnpm versions and your own `.env.local`.
2. Work on a feature branch. Do not overwrite collaborators' changes or rewrite
   shared Git history.
3. Keep changes inside the relevant feature. `features/boston-map`,
   `features/live-track` and `features/camera-triage` are shared by the dashboard
   and `/map`; fix them once rather than forking a copy into either route.
4. Run `pnpm run verify`. Commit `pnpm-lock.yaml` with dependency changes.
   Generate lockfile updates with pnpm 12.4.2, then verify `pnpm install --frozen-lockfile` in a clean
   checkout and wait for both Linux and Windows GitHub checks to pass.
   If rebuilding a broken lockfile, use a clean writable pnpm store as well;
   optional dependency fetch failures can otherwise leave incomplete entries.
5. Run `pnpm run format` before committing formatting-sensitive changes; CI enforces
   `pnpm run format:check`.
6. For map/UI changes, check both `/` and `/map` at desktop and phone-sized
   viewports. Confirm that switching light/dark restores the 3D layer, the route
   lines and the live units, and preserves the camera.
7. Submit the code with a short explanation and verification results.

Do not commit tokens, `.env.local`, generated builds, `node_modules`, personal GPS
coordinates, or account credentials. Tests must not call live tracking services
or require a teammate's Mapbox account.
