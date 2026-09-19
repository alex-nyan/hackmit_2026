# Contributing

1. Follow the README quick start, using the pinned Node/npm versions and your own `.env.local`.
2. Work on a feature branch. Do not overwrite collaborators' changes or rewrite
   shared Git history.
3. Keep changes inside the relevant feature. Preserve the clean map-only baseline
   until the team explicitly agrees to add a capability.
4. Run `npm run verify`. Commit `package-lock.json` with dependency changes.
   Generate lockfile updates with npm 12.0.2, then verify `npm ci` in a clean
   checkout and wait for both Linux and Windows GitHub checks to pass.
   If rebuilding a broken lockfile, use a clean writable npm cache as well;
   optional dependency fetch failures can otherwise leave incomplete entries.
5. Run `npm run format` before committing formatting-sensitive changes; CI enforces
   `npm run format:check`.
6. For map/UI changes, check the real map at desktop and phone-sized viewports.
   Confirm that switching light/dark restores the 3D layer and preserves the camera.
7. Submit the code with a short explanation and verification results.

Do not commit tokens, `.env.local`, generated builds, `node_modules`, personal GPS
coordinates, or account credentials. Tests must not call live tracking services
or require a teammate's Mapbox account.
