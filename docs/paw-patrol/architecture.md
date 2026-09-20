# Paw Patrol architecture

This is frontend demonstration software, not an operational public-safety or medical system.

**Current integration:** [Audio-first AI architecture and runbook](../audio-ai-demo.md)
documents the implemented microphone → local Whisper → semantic LLM → shared
incident → dispatcher review path. The scenario below remains simulated, but real
capture observations and review events now cross browsers through `/api/incidents`.
The native authenticated v2 backend is a separate mode, not automatically merged.

## One scenario across three views

The [root development launcher](../../../docs/development.md) runs this shared
code in three processes: Dispatch (5176), Officer (5177) and Hospital (5178).
Server configuration selects a fixed workspace; generated outputs are isolated
per process. Running this app's own `npm run dev` retains the combined demo with
workspace tabs. These entry points select presentation, not an authorization role.

`scenario.ts` owns fictional identities, fixed geographical coordinates, chronological
events, pulse samples and derived status. `useScenario.ts` owns a single reducer and
clock. Workspace switching preserves it; pause, reset, skip and completion are atomic.
Scenario clocks remain local to each browser. Capture observations and explicit
incident actions are published to a shared log (Blob, or an explicit local demo
file), and the dashboards poll that log. Some notes and animated demo state remain
local. The app passphrase gate is distinct from the scoped native v2 authorization.

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
The default viewer still preserves the original non-interactive presentation. The
ambulance workspace opts into nine approximate external surface regions. Raycasting
and keyboard region buttons drive the same selection; vertex colours distinguish
selection from a review marker. These zones are not individual organs, internal
anatomy segmentation, a diagnosis, or the 2,234-mesh Human Atlas dataset.

`HospitalAssessment` keeps body, notes and camera choices scoped to the selected
person and resets them on profile/session changes. Received incident records have
no structured anatomical location, so `bodyEvidence` leaves them unlocalized.
Pulse and free text never generate a body-region finding. Offline/older records
are marked stale. Demo markers require explicit opt-in; manual review notes remain
local to this view and are not published or sent to the AI pipeline.

`HospitalSceneFeed` reads the existing frame relay and labels it as updating stills,
not continuous video. An explicit source picker cannot change patient identity.
Missing sources never silently substitute another camera, and failed/stale frames
cannot display a current-frame label. An existing person-matched remote MediaStream
continues through `OfficerFeed` without starting capture or owning its tracks.
Neither observations nor body markers change the separate ambulance STOP/GO signal.

The Officer dashboard opens to briefing/map presentation. Pairing controls remain
mounted behind the compact Setup button; hiding setup does not disconnect devices.
The existing capture permission, explicit stop, person-reset and document-hidden
privacy behaviour remains unchanged.

## Future integration boundary

Browser audio, camera, GPS and Bluetooth have concrete integrations; the linked
connection map shows which paths reach AI. Agree a timestamped, authenticated
feed contract with hardware/model owners before replacing the scenario provider. Track
source identity, freshness, uncertainty and disconnection separately. Keep media and
health data private and access-controlled. The native v2 backend provides separate
incident state and enrollment. Authorized external dispatch and transport
coordination remain future integrations.

## Optional browser tools

The feature-detected WebMCP tools read demo state, control playback, and select a workspace
or fictional person. They reuse UI state/actions, validate input and unregister on unmount.
Unsupported browsers ignore them. No tool makes an external emergency-service request.
