# Contributing

1. Follow the README quick start, using the pinned Node/npm versions and your own `.env.local`.
2. Work on a feature branch. Do not overwrite collaborators' changes or rewrite
   shared Git history.
3. Keep changes inside the relevant feature. Preserve the shared scenario clock,
   per-person state and explicit synthetic-data labels. Hardware/backend integration
   requires a separately agreed feed contract and privacy controls.
4. Run `pnpm run verify` from the repository root. Commit `pnpm-lock.yaml` with dependency changes.
   Generate lockfile updates with npm 11.6.2, then verify `npm ci` in a clean
   checkout. Once a separate GitHub repository is connected, check both Linux and Windows CI.
   If rebuilding a broken lockfile, use a clean writable npm cache as well;
   optional dependency fetch failures can otherwise leave incomplete entries.
5. For map/UI changes, check the real map at desktop and phone-sized viewports.
   Confirm that switching light/dark restores the 3D layer and preserves the camera.
6. Submit the code with a short explanation and verification results.

Do not commit tokens, `.env.local`, generated builds, `node_modules`, personal GPS
coordinates, or account credentials. Tests must not call live tracking services
or require a teammate's Mapbox account.
