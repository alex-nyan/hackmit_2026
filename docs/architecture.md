# Map foundation

## Scope

The map is a port of the working GridLens preview, not a redesign. Its geographic
scope is Greater Boston; the original reference document's NUS coordinates and
energy overlays have intentionally not been carried over.

## Boundaries

- `app/page.tsx` composes the map feature. Future dashboard routes can be added
  without putting unrelated business logic in the map renderer.
- `BostonMapShell.tsx` owns the selected area, theme, and visible load feedback.
- `BostonMap.tsx` owns the Mapbox instance, events, resize observer, and cleanup.
  Mapbox is loaded on the client only. React rerenders do not recreate the map.
- `mapboxClient.ts` is the lazy-loading boundary for the browser dependency;
  lifecycle tests substitute it without WebGL or live network requests.
- `types.ts` defines the focus presets and shared feature types.
- Building layer configuration is isolated from UI state so it can be tested and
  restored when Mapbox replaces a style.
- `app/globals.css` and `BostonMap.module.css` preserve the existing visual design.

## Rendering contract

Use Mapbox `light-v11` / `dark-v11`, `antialias: true`, pitch 45 degrees, and bearing
-17.6 degrees for close-up presets. The overview uses a lower pitch and zoom.
Coordinates always use **[longitude, latitude]**. Keep the existing preset values
unless a change to the viewing experience is intentional.

The `3d-buildings` layer reads the style's `composite` source, `building` source
layer, and real `height` / `min_height` values. Extrusions animate from zero at
zoom 15 to real height at 15.05. Labels remain above buildings. Switching styles
removes custom layers, so they must be registered again on `style.load`.

Initialization is asynchronous. Latest theme/focus values must be used even when
the user clicks before Mapbox finishes importing. Cleanup must cancel pending
work, clear load timers, disconnect observers, and remove the Mapbox instance.
Strict Mode is enabled to exercise mount/unmount behavior during development.

## Future live GPS

No GPS connection exists in this foundation. A future implementation should:

1. Establish an authenticated server-side connection to the selected tracking
   service (for example Traccar), without putting credentials into browser code.
2. Authorize access to the device and send only the position data the viewer needs.
3. Validate coordinates and timestamps at the boundary; represent accuracy and
   stale/offline readings honestly, rather than simulating movement.
4. Add a separate GeoJSON source/layer and update it with `setData` instead of
   replacing the map or rebuilding the 3D buildings.
5. Restore that source/layer after style changes and clean up subscriptions.
6. Provide explicit opt-in/stop controls and avoid retaining location history by
   default. Use an appropriate hosted realtime service if the deployment platform
   cannot sustain the required long-lived connections.

Do not add phone tracking, analytics, database scaffolding, or placeholder data
until those capabilities are requested and their data/access requirements are known.

## Verification

Run `npm run verify` before submitting changes. Automated tests cover configuration
and mocked rendering lifecycle behavior; they do not replace a real WebGL check.
With a valid public token, manually verify all location buttons, both themes,
visible building heights, zoom/rotation, resize/mobile layout, and absence of
browser errors. Confirm the production build as well as the development server.
