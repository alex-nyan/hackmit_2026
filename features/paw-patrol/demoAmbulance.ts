import { nearestRoadPoint, validHotspotPoint, wrapRouteDistance } from "./hotspots";
import {
  PATROL_UNITS,
  distanceMeters,
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

function stagingDistance(geometry: RouteGeometry, hotspot: VehiclePoint): number | null {
  const nearest = nearestRoadPoint(geometry, hotspot);
  if (nearest.gap > 350) return null;
  if (nearest.gap >= 150) return nearest.distance;
  // Stop on the approach, approximately 150 m away. This is a visual demo rule,
  // not an EMS safety distance, scene assessment, or authorization to enter.
  for (let step = 10; step <= Math.min(geometry.lengthMeters, 1_000); step += 10) {
    const at = wrapRouteDistance(nearest.distance - step, geometry.lengthMeters);
    const gap = distanceMeters(pointAtDistance(geometry, at), hotspot);
    if (gap >= 150 && gap <= 350) return at;
  }
  return null;
}

/** Preserve each original road vertex while slicing a forward arc around a closed loop. */
function forwardRoadArc(geometry: RouteGeometry, start: number, end: number): VehiclePoint[] {
  const travel = wrapRouteDistance(end - start, geometry.lengthMeters);
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
    const end = stagingDistance(station.geometry, point);
    if (end === null) return [];
    const route = forwardRoadArc(station.geometry, station.stationDistance, end);
    const geometry = prepareRouteGeometry(route);
    if (geometry.lengthMeters <= 2) return [];
    return [{ station, route, geometry }];
  }).sort((a, b) => a.geometry.lengthMeters - b.geometry.lengthMeters);
  const candidate = candidates.find(({ station }) => !busyStationNames.includes(station.name));
  if (!candidate) {
    return {
      plan: null,
      reason: candidates.length
        ? "All demo health centres with a supplied road route to this hotspot are busy. Resolve their active hotspots before requesting another ambulance."
        : "No supplied demo road loop reaches a staging point 150–350 m from this hotspot. Choose a hotspot near the demo patrol roads.",
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
