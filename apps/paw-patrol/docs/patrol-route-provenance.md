# Patrol street-route provenance

These are deterministic **simulated movements**, not officer GPS fixes, operational navigation, or an emergency routing service. The vehicle paths are stored road-following geometry, not straight lines between distant locations.

## Source and reproducibility

- Provider: [OSRM public routing service](https://router.project-osrm.org), `route/v1/driving`.
- Retrieval: **2026-09-19 23:40:43 UTC**.
- Underlying road data: OpenStreetMap. Attribution: **© OpenStreetMap contributors; routes computed with OSRM**. [OpenStreetMap copyright and database license](https://www.openstreetmap.org/copyright).
- Parameters: `overview=full&geometries=geojson&steps=true`.
- Each route entry in `features/paw-patrol/vehicles/street-routes.json` retains its complete provider request URL, requested waypoints, provider leg index, road names, source leg distance, and clipping offsets where applicable.
- The provider did not supply a `data_version` timestamp. `sourceDataVersion` is therefore `null`; retrieval time is not presented as the road database's update date.
- Four successful provider requests generated the seven committed legs. One exploratory request identified the old incident point as a driveway; it was not used for the final routes. There are **no runtime routing requests or embedded API keys**.

The [OSRM API specification](https://project-osrm.org/docs/v5.24.0/api/#route-service) defines route geometry and snapping. Requested points are snapped by the provider to its routable road network. Consecutive duplicate coordinates from maneuver/arrival boundaries were removed, without simplifying or replacing the road shape. Distances in `distanceMeters` are recalculated along the final stored coordinates with a mean-Earth-radius haversine calculation; provider distances are retained separately and differ slightly.

## Scenario layout

The incident is on **Main Street**, at `[-71.090794, 42.362764]`. It replaces the earlier off-street incident coordinate. Staging locations are separate on-road points approximately 17 m west and 19 m east of the incident, not four vehicles stacked at one coordinate.

| Unit / leg | Demo seconds | Final distance | Average demo speed | Streets |
| --- | --- | --- | --- | --- |
| P-01 patrol | 0–15 | 99.672 m | 6.645 m/s | Main Street |
| P-01 transport representation | 60–90 | 300 m | 10 m/s | Main Street → Galileo Galilei Way |
| P-02 patrol | 0–30 | 211.775 m | 7.059 m/s | Albany Street |
| P-02 response | 30–45 | 168.549 m | 11.237 m/s | Albany Street → Main Street |
| P-03 patrol | 0–30 | 276.359 m | 9.212 m/s | Broadway → Ames Street → Main Street |
| P-03 response | 30–45 | 170.600 m | 11.373 m/s | Main Street |
| P-04 Harvard patrol | 0–90 | 720 m | 8 m/s | Mount Auburn Street → Holyoke Street → Massachusetts Avenue → Peabody Street → Massachusetts Avenue → Garden Street |

P-01 stays at the incident from 15 through 60. P-02/P-03 stop at their respective staging points after 45. Route completion holds the last position; routes are not silently looped. A deliberate demo reset/replay returns units to their initial positions. Patrol/response and patrol/transport joins use exactly the same stored endpoint coordinate, so changing a scenario stage does not teleport a vehicle.

P-01's transport representation uses the first **300 m** of the provider's second leg, ending at `[-71.089404509, 42.364735688]` on Galileo Galilei Way. This is explicitly a **simulated receiving point, not an actual hospital**. The former cross-river endpoint was unsuitable for believable travel within 30 demo seconds. The map vehicle represents the selected unit's scenario location during transport; it does not assert that a real patrol car is an ambulance.

P-04 uses a **720 m continuous subset** of its returned Harvard street route, starting at the Mount Auburn/Dunster junction. A short unnamed access-road prefix was omitted. Both clipped final coordinates are calculated within existing provider line segments, not joined to a new off-road destination. The original requested route and offsets remain recorded for reconstruction.

## Boundaries and verification

- Every source request returned `code: "Ok"` and road geometry; none uses a guessed shortcut, water crossing, or fallback line.
- All seven final geometries contain finite longitude/latitude pairs and at least two distinct points. All moving intervals are positive; all listed average speeds are below 16 m/s.
- These checks establish provenance and internal continuity, **not visual browser verification**. The integrated app must still be inspected at street and city zoom, pitch, and bearing.
- OSM/OSRM is not a lane-level model. Geometry follows the routing network; it does not include traffic signals, curb approach, emergency access privileges, dynamic closures, lane offsets, or collision avoidance. Vehicles may share a road centerline. Do not use it for operational dispatch or navigation.
- Road shapes and imagery/building tiles can differ because Mapbox and OSRM use different data snapshots. No exact citywide data freshness or legal emergency route guarantee is made.
