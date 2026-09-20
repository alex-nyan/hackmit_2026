# Map foundation

## Visual hazard triage service

`services/triage` adds authenticated visual evidence processing for incident
verification and operational triage. It combines YOLO26 object evidence with local
Ollama `gemma4:26b`, or an explicitly enabled OpenAI-compatible vision API. Every
result requires human review. See [the service architecture and runbook](hazard-triage.md)
for the editable Mermaid diagram, confidence semantics, API, and deployment limits.
The service does not yet connect live cameras, dispatch, or clinical workflows.

## Scope

The map is a port of the working local preview, not a redesign. Its geographic
scope is Greater Boston; the original reference document's NUS coordinates and
energy overlays have intentionally not been carried over.

## One app, two maps

The repository is a single Next.js app. `app/page.tsx` is the Paw Patrol dashboard
and `app/map/page.tsx` is the standalone Boston map; both draw on the same
`features/boston-map` primitives, and both reach the same server bridges under
`app/api`. The dashboard is pinned to one role by `PAW_PATROL_WORKSPACE`, which
also selects its `distDir` and TypeScript project so three concurrent dev servers
cannot overwrite one another's output.

The two maps differ in what they add on top of the shared building layer:

- `BostonMap.tsx` (`/map`) is the plain map: buildings, selection and live units.
- `OperationsMap.tsx` (`/`) adds the scenario clock, 3D patrol vehicle meshes and
  route lines, and drives them from one `requestAnimationFrame` loop that never
  sets React state per frame. It reuses the same `buildingLayer`, `liveLayer` and
  `buildingSelection` modules rather than forking them, so a fix to freshness or
  footprint maths lands in both.

Styling is split the same way: `app/globals.css` holds the dashboard design system
plus the shared capture, fleet and building widgets, and `app/map/map.css` is
imported only by `/map`, so the map's neutral chrome and the dashboard's palette
never fight over the cascade.

## Boundaries

- `app/page.tsx` composes the dashboard; `app/map/page.tsx` composes the map.
  Neither puts business logic in the map renderer.
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

Depth comes from lighting, not from recolouring: ambient occlusion (stronger on
the dark theme, where flat silhouettes merge), the vertical gradient, and a small
`fill-extrusion-edge-radius` bevel. The original palette is unchanged —
`#d2cec5` light and `#81939b` dark — but colour is now a `case` expression whose
unselected branch carries those values, so a picked building can recolour without
a second layer. `fill-extrusion-edge-radius` is a **layout** property and is
marked experimental by Mapbox; if it is dropped, edges fall back to square.

Initialization is asynchronous. Latest theme/focus values must be used even when
the user clicks before Mapbox finishes importing. Cleanup must cancel pending
work, clear load timers, disconnect observers, and remove the Mapbox instance.
Strict Mode is enabled to exercise mount/unmount behavior during development.

## Building selection

Clicking queries `3d-buildings` at the click point and moves a `selected` feature
state, which the colour expression reads. One map-level `click` handler decides
both selection and dismissal, because a layer-scoped handler and a map-level one
would race over which fires first. Feature state does not survive a style change,
so `style.load` drops the selection rather than leaving a highlight Mapbox can no
longer draw.

`buildingSelection.ts` derives the facts shown in the panel. Values come from the
tile and nothing is inferred: a missing `height` reads "not recorded" rather than
zero, `min_height` of 0 is reported as no base rather than a base at ground level,
and floor counts are never estimated from height. Footprint area is real spherical
area (Chamberlain & Duquette), outer ring minus holes — but vector tiles clip
geometry at tile boundaries, so a building crossing an edge measures only the part
in the clicked tile. The panel says so rather than presenting a partial figure as
the whole.

Not every tile carries a feature id. Without one there is nothing to attach state
to, so the building is still reported but not highlighted.

On the dashboard map the same click handler also owns unit selection. A patrol
vehicle wins any pixel it shares with the building behind it, because the vehicles
are Three.js meshes that `queryRenderedFeatures` cannot see — they are picked by
projecting their current positions to screen space, so the building query only runs
once no unit is within reach.

## Live GPS

Both maps show every unit reporting to a shared [Traccar](https://www.traccar.org)
server, so a team can see each other simultaneously. Tracking is **opt-in**:
nothing is requested until the viewer presses the locate button, and turning it off
aborts the in-flight request and drops the positions. On the dashboard the real
units are drawn over the simulated patrol vehicles and are never merged with them;
the scenario clock and the Traccar poll stay separate sources.

The fleet costs two upstream requests regardless of its size — one for devices, one
for latest positions — and positions are grouped by device in a single pass. Adding
a unit in Traccar needs no redeploy; it appears on the next poll. `TRACCAR_DEVICE_IDS`
optionally restricts the view to named ids; blank means every device the account
can see.

- `app/api/live-position/route.ts` is the only place that talks to Traccar. It is
  `force-dynamic` and `no-store`, because a cached location is a wrong location.
- `traccarSource.ts` holds the credentials boundary. It reads `TRACCAR_URL`,
  `TRACCAR_EMAIL`, `TRACCAR_PASSWORD`, and `TRACCAR_DEVICE_ID` from the server
  environment and authenticates with HTTP Basic. None of these may be prefixed
  `NEXT_PUBLIC_`; that would ship the password to the browser. Upstream errors are
  reduced to a status code so a Traccar response body cannot echo the account back
  to the client.
- `position.ts` is the validation boundary. It rejects records that are not usable
  positions — `valid: false`, non-finite or out-of-range coordinates, the 0,0
  placeholder a device reports before its first fix, unparseable timestamps — and
  nulls accuracy, speed, and heading rather than inventing them. Only the eight
  viewer-facing fields cross into the browser.
- `liveLayer.ts` owns a `live-position` GeoJSON source updated through `setData`,
  carrying one point, one accuracy ring and one name label per unit. The map
  instance and the 3D buildings are never rebuilt for a position update.
  `style.load` re-adds the source and layers, because Mapbox drops them when the
  style is replaced, and label colour follows the theme.
- A unit with no usable fix stays in the roster and is left off the map, rather
  than being hidden or drawn at a placeholder coordinate.

### Device time, not server time

Traccar Client buffers fixes while it cannot reach the server and flushes them
later, so `serverTime` can trail `deviceTime` by many minutes, and rows can arrive
out of order relative to when they were recorded. Two consequences shape this code:

1. Every freshness decision uses the device fix time. `serverTime` is never used to
   age a fix.
2. `newestFix` orders explicitly by device time instead of trusting Traccar's own
   latest-position pointer, which follows `deviceTime` and can therefore point at
   an older row than the one most recently inserted.

Freshness is reported honestly rather than smoothed: `live` within 90 seconds
(green), `stale` within 10 minutes (amber), `lost` beyond that (grey), each with its
own label. Only green means "here now". With several units on one map this is a
correctness property, not decoration — a stale position rendered as current is the
failure that matters, so degraded states keep distinct colours.
Traccar's `online` flag tracks when data last arrived, not how fresh the fix is, so
the two are surfaced as separate facts — a device can be online with a fix that is
half an hour old. Positions are never interpolated and movement is never simulated.

No location history is retained: the client holds only the latest fix, and the
server stores nothing.

## Verification

Run `pnpm run verify` before submitting changes. Automated tests cover configuration
and mocked rendering lifecycle behavior; they do not replace a real WebGL check.
With a valid public token, manually verify all location buttons, both themes,
visible building heights, zoom/rotation, resize/mobile layout, and absence of
browser errors. Confirm the production build as well as the development server.
