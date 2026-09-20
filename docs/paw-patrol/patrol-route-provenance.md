# Boston patrol loops

The demo runs 15 simulated cars continuously on five closed road routes: Downtown, Back Bay, South End, Fenway, and Beacon Hill. Each loop has three cars spaced one third of a lap apart. Cars follow the stored driving direction at 7–9.6 m/s. Distance wraps at the loop boundary; heading samples wrap too, so cars do not teleport or reverse on each lap.

## Route source

`features/paw-patrol/vehicles/patrol-loops.json` contains full road geometry retrieved from the OSRM public routing service on 2026-09-20 at 03:32 UTC. Each entry preserves its provider request URL, requested waypoints, road names, and provider distance. All five geometries have identical first and last coordinates. No runtime routing request is needed.

Attribution: © OpenStreetMap contributors; routes computed with OSRM. Provider: https://router.project-osrm.org. Road data terms: https://www.openstreetmap.org/copyright.

## Playback

The shared elapsed-time clock supports pause, resume, and reset. There is no 90-second ending and no timed incident, backup response, injury, scene clearance, transport, or handoff. The tool's forward action advances only patrol time. Manual reports and actual camera/audio processing remain separate from patrol playback.

Coordinates represent the cached road network, not individual lanes or real GPS fixes. The demo does not model traffic signals, collisions, closures, or emergency privileges. Mapbox buildings and OSRM roads may reflect different source snapshots.
