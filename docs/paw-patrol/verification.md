# Local verification

Checked 19 September 2026 at http://localhost:5176.

## Automated checks

`npm run verify` passes lockfile validation, TypeScript, ESLint, 37 tests
(4 Node tests and 33 Vitest tests), and the production build. The consult tests cover
unsafe/unknown scene holds, oversized time jumps, explicit clearance, per-person panic,
acknowledgement, reset/replay and BP validation.

The nested app also passed a fresh `npm ci` and token-free production build.
The preserved root app passed its separate `pnpm run verify`: formatting,
TypeScript, ESLint, 81 tests and production build. Root `app/`, `features/`,
`services/`, dependency manifests and lockfiles have no changes from the branch base.

## Browser checks

Consult update checked in-browser: panic holds the clock at 00:59 with EMS staging;
command acknowledgement does not clear the scene; explicit clearance permits 01:00
transport. A saved simulated palpated systolic reading remains on P-01, does not
appear on P-02, and reappears when returning to P-01.

- Command, Officer and Hospital workspaces render from shared demo state.
- Automatic playback reaches 90 seconds and stops at the completed handoff.
- Map buildings render from Mapbox. Marker selection, Harvard/MIT camera
  controls and light/dark themes work; dark label contrast was improved.
- Selected people update their identity and sample pulse. Other officers do
  not inherit P-01's scripted injury or hospital case.
- The supplied body model was inspected from front, side and back. Rotation,
  zoom, view reset and keyboard rotation were exercised.
- Temporarily withholding the local model triggered the failure/retry UI.
  Restoring the asset and retrying successfully recovered the viewer.
- Layout checked at 1440, 1024 and 400 pixels wide. Narrow Command and Hospital
  views had no horizontal document overflow; the compact header was refined.

## Boundaries

These checks are not a clinical, device, security or real dispatch validation.
No hardware feed, inference service, backend or external emergency-service
integration exists. The generic body has no clinical region mapping.
WebGL-unavailable/context-loss behavior is implemented but was not exercised
on an actual unsupported device. Touch gestures and other physical browsers
need their own testing. No Vercel deployment was performed. The dashboard is distributed
on the `codex/paw-patrol-dashboard` branch; see GitHub Actions for hosted CI results.
