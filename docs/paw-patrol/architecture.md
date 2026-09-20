# Paw Patrol architecture

This is frontend demonstration software, not an operational public-safety or medical system.

## One scenario across three views

The [root development launcher](../../../docs/development.md) runs this shared
code in three processes: Dispatch (5176), Officer (5177) and Hospital (5178).
Server configuration selects a fixed workspace; generated outputs are isolated
per process. Running this app's own `npm run dev` retains the combined demo with
workspace tabs. These entry points select presentation, not an authorization role.

`scenario.ts` owns fictional identities, fixed geographical coordinates, chronological
events, pulse samples and derived status. `useScenario.ts` owns a single reducer and
clock. Workspace switching preserves it; pause, reset, skip and completion are atomic.
There is no network ingestion, database, authentication or synchronization across browsers.
Each separate port/browser has its own scenario, panic state, notes and handoff
entries. Shared operational state requires an explicit backend integration.

The UI never derives an injury from a weapon flag or pulse. An explicit script event
at 45 seconds introduces the injury. Only P-01 receives that annotation. Other selected
people show their own status and no injury note. The receiving view is a local rendering,
not a real hospital acknowledgement.

## Maps

Mapbox light-v11/dark-v11 supplies real map geometry. The preserved building layer
reads real vector height/min_height fields; buildings are extruded from zoom 15.
`OperationsMap` manages one map instance, stable DOM officer markers, route sources,
style reloads, state refs, resize, timers and cleanup. Synthetic routes are explicitly
illustrative and must not be used for navigation. They are not calculated road routes.

`OperationsMapPanel` wraps it with the chrome — heading, follow/recentre/tracking/theme
controls, area switch, telemetry and legend — and Dispatch, Officer and Hospital all
mount that one panel. The three roles disagreeing about whether there was a map at all
meant they could not talk about the same picture. The panel owns only view state for its
own screen (area, theme, follow, tracking, building selection); positions come from the
shared scenario clock, so every workspace draws the same units at the same second.

Position colour is fixed per role and is never reused for state: green is an officer,
red is a reported person of interest (`suspects.ts`). Both draw a pulsing ground beacon
plus a label, so the reading survives zoom, the 3D vehicle layer failing, and colour
being unavailable to the viewer. Urgency changes the beacon's rhythm, not its hue. A
report is not a unit: its chip is inert, carries `UNVERIFIED`, and names its source.

## Human visualization

The local GLB uses the supplied Blender Studio bundle's realistic male body and eyes.
The scene preserves geometry, normals and UVs. Source assets have no materials/textures;
glTF's neutral default material is lit in the browser. The model is generic across all
fictional identities and does not imply sex, injury location or an actual body scan.

`AnatomyViewer` remounts its rendering session when personId changes. Fetch uses an
AbortController and timeout; delayed parse completions dispose themselves. ResizeObserver
maintains aspect, camera presets use spherical interpolation, and unmount disposes GPU
resources, controls, animation loops and listeners. Full-body fitting uses actual bounds.
There is no region picker: source anatomy is one continuous body mesh plus two eyes.
Text annotations explicitly state the location has not been mapped.

## Future integration boundary

Hardware and models are outside this implementation. Agree a timestamped, authenticated
feed contract with hardware/model owners before replacing the scenario provider. Track
source identity, freshness, uncertainty and disconnection separately. Keep media and
health data private and access-controlled. A separate backend would be needed for shared
incident state, recording, transport coordination and authorized external actions.

## Optional browser tools

The feature-detected WebMCP tools read demo state, control playback, and select a workspace
or fictional person. They reuse UI state/actions, validate input and unregister on unmount.
Unsupported browsers ignore them. No tool makes an external emergency-service request.
