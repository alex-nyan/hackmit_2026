import { nearestRoadPoint, validHotspotPoint, wrapRouteDistance } from "./hotspots";
import {
  PATROL_UNITS,
  headingAtDistance,
  motionAtElapsed,
  pointAtDistance,
  prepareRouteGeometry,
  type RouteGeometry,
  type VehiclePoint,
} from "./vehicles/vehicleMotion";

export type DemoAmbulanceMission = {
  id: string;
  hotspotId: string;
  hotspotPoint: VehiclePoint;
  stationName: string;
  stationPoint: VehiclePoint;
  stagingPoint: VehiclePoint;
  route: VehiclePoint[];
  /** Shared demo-clock seconds, not a real-world dispatch time or ETA. */
  startedAt: number;
  duration: number;
  status: "en-route" | "staged" | "engaged" | "cancelled";
  createdAt: string;
  updatedAt: string;
  engagedAt: string | null;
  /** Cancellation freezes the marker at this demo-clock time. */
  stoppedAt?: number;
};

export type DemoHealthCentre = {
  id: string;
  name: string;
  area: string;
  point: VehiclePoint;
  geometry: RouteGeometry;
  stationDistance: number;
};

/** Invented demo stations placed on existing road loops; these are not real facilities. */
export const DEMO_HEALTH_CENTRES: DemoHealthCentre[] = PATROL_UNITS.filter(
  (unit, index, units) =>
    units.findIndex((candidate) => candidate.loopId === unit.loopId) === index,
).map((unit, index) => {
  const stationDistance = unit.geometry.lengthMeters * (0.08 + index * 0.04);
  return {
    id: `demo-health-${unit.loopId}`,
    name: `Demo ${unit.area} Health Centre`,
    area: unit.area,
    point: pointAtDistance(unit.geometry, stationDistance),
    geometry: unit.geometry,
    stationDistance,
  };
});

type DemoAmbulancePlan = Pick<
  DemoAmbulanceMission,
  "stationName" | "stationPoint" | "stagingPoint" | "route" | "duration"
>;

/** Preserve each original road vertex while slicing a forward arc around a closed loop. */
function forwardRoadArc(geometry: RouteGeometry, start: number, end: number): VehiclePoint[] {
  const travel = wrapRouteDistance(end - start, geometry.lengthMeters);
  // Projection roundoff at the station must not turn zero travel into a full lap.
  if (Math.min(travel, geometry.lengthMeters - travel) < 0.001) {
    return [pointAtDistance(geometry, end)];
  }
  const coordinates: VehiclePoint[] = [pointAtDistance(geometry, start)];
  for (let lap = 0; lap < 2; lap++) {
    for (let index = 1; index < geometry.coordinates.length; index++) {
      const distance = geometry.cumulativeMeters[index] + lap * geometry.lengthMeters;
      if (distance > start && distance < start + travel) {
        coordinates.push([...geometry.coordinates[index]]);
      }
    }
  }
  coordinates.push(pointAtDistance(geometry, end));
  return prepareRouteGeometry(coordinates).coordinates;
}

export function planDemoAmbulance(
  point: VehiclePoint,
  busyStationNames: readonly string[] = [],
): { plan: DemoAmbulancePlan | null; reason: string } {
  if (!validHotspotPoint(point)) return { plan: null, reason: "This hotspot location is invalid." };
  const candidates = DEMO_HEALTH_CENTRES.flatMap((station) => {
    if (station.geometry.lengthMeters <= 0 || busyStationNames.includes(station.name)) return [];
    const nearest = nearestRoadPoint(station.geometry, point);
    if (!Number.isFinite(nearest.gap)) return [];
    // Stay on this station's supplied roads. A flag can be off-road; its closest
    // reachable road point is a demo stop, never an assertion of scene safety.
    const route = forwardRoadArc(station.geometry, station.stationDistance, nearest.distance);
    const geometry = prepareRouteGeometry(route);
    return [{ station, route, geometry, gap: nearest.gap }];
  }).sort((a, b) => a.gap - b.gap || a.geometry.lengthMeters - b.geometry.lengthMeters);
  const candidate = candidates[0];
  if (!candidate) {
    return {
      plan: null,
      reason: "No ambulance is available. Resolve an active ambulance incident to free a unit.",
    };
  }
  return {
    plan: {
      stationName: candidate.station.name,
      stationPoint: [...candidate.station.point],
      stagingPoint: [...candidate.route[candidate.route.length - 1]],
      route: candidate.route,
      duration: Math.max(24, Math.min(45, candidate.geometry.lengthMeters / 60)),
    },
    reason:
      "Accelerated demo journey. The invented station and staging point are not real EMS routing or safety guidance.",
  };
}

const geometryCache = new WeakMap<VehiclePoint[], RouteGeometry>();

export function sampleDemoAmbulance(mission: DemoAmbulanceMission, time: number) {
  let geometry = geometryCache.get(mission.route);
  if (!geometry) {
    geometry = prepareRouteGeometry(mission.route);
    geometryCache.set(mission.route, geometry);
  }
  const at = mission.status === "cancelled" ? (mission.stoppedAt ?? mission.startedAt) : time;
  const elapsed =
    mission.status === "staged" || mission.status === "engaged"
      ? mission.duration
      : Math.max(0, at - mission.startedAt);
  const { distance } = motionAtElapsed(geometry.lengthMeters, mission.duration, elapsed);
  return {
    point: pointAtDistance(geometry, distance),
    heading: headingAtDistance(geometry, distance),
  };
}
