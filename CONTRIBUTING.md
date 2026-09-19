# Contributing

1. Follow the README quick start, using Node 22 and your own `.env.local`.
2. Work on a feature branch. Do not overwrite collaborators' changes or rewrite
   shared Git history.
3. Keep changes inside the relevant feature. Preserve the clean map-only baseline
   until the team explicitly agrees to add a capability.
4. Run `npm run verify`. Commit `package-lock.json` with dependency changes.
5. For map/UI changes, check the real map at desktop and phone-sized viewports.
   Confirm that switching light/dark restores the 3D layer and preserves the camera.
6. Submit the code with a short explanation and verification results.

Do not commit tokens, `.env.local`, generated builds, `node_modules`, personal GPS
coordinates, or account credentials. Tests must not call live tracking services
or require a teammate's Mapbox account.
