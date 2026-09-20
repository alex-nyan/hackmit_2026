# Boston patrol loops

The demo runs 15 simulated cars continuously on five closed road routes: Downtown, Back Bay, South End, Fenway, and Beacon Hill. Each loop has three cars spaced one third of a lap apart. Cars follow the stored driving direction at 7–9.6 m/s. Distance wraps at the loop boundary; heading samples wrap too, so cars do not teleport or reverse on each lap.

## Route source

`features/paw-patrol/vehicles/patrol-loops.json` contains full road geometry retrieved from the OSRM public routing service on 2026-09-20 at 03:32 UTC. Each entry preserves its provider request URL, requested waypoints, road names, and provider distance. All five geometries have identical first and last coordinates. No runtime routing request is needed.

Attribution: © OpenStreetMap contributors; routes computed with OSRM. Provider: https://router.project-osrm.org. Road data terms: https://www.openstreetmap.org/copyright.

## Playback

The shared elapsed-time clock supports pause, resume, and reset. There is no 90-second ending and no timed incident, backup response, injury, scene clearance, transport, or handoff. The tool's forward action advances only patrol time. Manual reports and actual camera/audio processing remain separate from patrol playback.

| Unit / leg                    | Demo seconds | Final distance | Average demo speed | Streets                                                                                                             |
| ----------------------------- | ------------ | -------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------- |
| P-01 patrol                   | 0–15         | 99.672 m       | 6.645 m/s          | Main Street                                                                                                         |
| P-01 transport representation | 60–90        | 300 m          | 10 m/s             | Main Street → Galileo Galilei Way                                                                                   |
| P-02 patrol                   | 0–30         | 211.775 m      | 7.059 m/s          | Albany Street                                                                                                       |
| P-02 response                 | 30–45        | 168.549 m      | 11.237 m/s         | Albany Street → Main Street                                                                                         |
| P-03 patrol                   | 0–30         | 276.359 m      | 9.212 m/s          | Broadway → Ames Street → Main Street                                                                                |
| P-03 response                 | 30–45        | 170.600 m      | 11.373 m/s         | Main Street                                                                                                         |
| P-04 Harvard patrol           | 0–90         | 720 m          | 8 m/s              | Mount Auburn Street → Holyoke Street → Massachusetts Avenue → Peabody Street → Massachusetts Avenue → Garden Street |

P-01 stays at the incident from 15 through 60. P-02/P-03 stop at their respective staging points after 45. Route completion holds the last position; routes are not silently looped. A deliberate demo reset/replay returns units to their initial positions. Patrol/response and patrol/transport joins use exactly the same stored endpoint coordinate, so changing a scenario stage does not teleport a vehicle.

P-01's transport representation uses the first **300 m** of the provider's second leg, ending at `[-71.089404509, 42.364735688]` on Galileo Galilei Way. This is explicitly a **simulated receiving point, not an actual hospital**. The former cross-river endpoint was unsuitable for believable travel within 30 demo seconds. The map vehicle represents the selected unit's scenario location during transport; it does not assert that a real patrol car is an ambulance.

P-04 uses a **720 m continuous subset** of its returned Harvard street route, starting at the Mount Auburn/Dunster junction. A short unnamed access-road prefix was omitted. Both clipped final coordinates are calculated within existing provider line segments, not joined to a new off-road destination. The original requested route and offsets remain recorded for reconstruction.

## Reported person of interest (`features/paw-patrol/suspects.ts`)

**Not currently drawn.** The scripted 90-second incident this report attaches to
was removed from the scenario, and a reported position with no report behind it
is a claim this demo does not make. The module and its tests are retained so the
track returns with the signal, not before it.

`S-01` is a **report the scenario invents**, not an identification, a detection, or anyone's recorded movement. The map draws it in red and labels it `UNVERIFIED`; the chip's accessible name carries the descriptor, the status and the source, so colour is never the only thing saying what it is.

- **No provider request was made for this track.** Its coordinates are a hand-authored subset of geometry already in `street-routes.json`: the Main Street vertices of `p-03-response`, reversed, beginning at the incident point `[-71.090794, 42.362764]`.
- Because those vertices come from OSRM's **driving** profile, they follow a road centreline. A person on foot would not; this is a demo approximation and is not a pedestrian route.
- Window: demo seconds **15–45**, 94 m, mean 3.1 m/s. The report appears with the scripted camera signal at 00:15 and never before it — a reported position that predates its report would be a claim the scenario never made. From 00:45 the last reported position is held; the track does not loop, drift or disappear.

| Track                  | Demo seconds | Distance | Average demo speed | Streets     |
| ---------------------- | ------------ | -------- | ------------------ | ----------- |
| S-01 reported movement | 15–45        | 94.3 m   | 3.14 m/s           | Main Street |

## Boundaries and verification

- Every source request returned `code: "Ok"` and road geometry; none uses a guessed shortcut, water crossing, or fallback line.
- All seven final geometries contain finite longitude/latitude pairs and at least two distinct points. All moving intervals are positive; all listed average speeds are below 16 m/s.
- These checks establish provenance and internal continuity, **not visual browser verification**. The integrated app must still be inspected at street and city zoom, pitch, and bearing.
- OSM/OSRM is not a lane-level model. Geometry follows the routing network; it does not include traffic signals, curb approach, emergency access privileges, dynamic closures, lane offsets, or collision avoidance. Vehicles may share a road centerline. Do not use it for operational dispatch or navigation.
- Road shapes and imagery/building tiles can differ because Mapbox and OSRM use different data snapshots. No exact citywide data freshness or legal emergency route guarantee is made.

Coordinates represent the cached road network, not individual lanes or real GPS fixes. The demo does not model traffic signals, collisions, closures, or emergency privileges. Mapbox buildings and OSRM roads may reflect different source snapshots.
