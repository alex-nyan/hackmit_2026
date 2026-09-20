import {
  PATROL_UNITS,
  bearingDegrees,
  distanceMeters,
  pointAtDistance,
  vehicleAt,
  type RouteGeometry,
  type VehiclePoint,
  type VehiclePosition,
} from "./vehicles/vehicleMotion";

/** Browser-local demo information, never a received incident or a dispatch command. */
export type DemoHotspot = {
  id: string;
  point: VehiclePoint;
  createdAt: number;
  resolvedAt: number | null;
  unitIds: string[];
};

export type DemoHotspotLog = {
  id: string;
  at: string;
  title: string;
  detail: string;
  hotspotId: string;
};

export type DemoUnitMotion = {
  baseTime: number;
  baseDistance: number;
  /** A received assistance request interrupts only this local simulated response. */
  held?: boolean;
  response?: {
    hotspotId: string;
    travelMeters: number;
    stagingGapMeters: number;
    arrivalLogged: boolean;
  };
};

export type DemoUnitMotions = Record<string, DemoUnitMotion>;

export const HOTSPOT_NEARBY_METERS = 1_500;
export const HOTSPOT_STAGING_METERS = 250;
export const HOTSPOT_MAX_RESPONDERS = 3;
export const HOTSPOT_MAX_ACTIVE = 8;

export function validHotspotPoint(point: VehiclePoint): boolean {
  return (
    point.length === 2 &&
    Number.isFinite(point[0]) &&
    Math.abs(point[0]) <= 180 &&
    Number.isFinite(point[1]) &&
    Math.abs(point[1]) <= 85
  );
}

export function wrapRouteDistance(distance: number, length: number): number {
  return length > 0 ? ((distance % length) + length) % length : 0;
}

/** Project onto supplied road segments, not a made-up straight-line response route. */
export function nearestRoadPoint(geometry: RouteGeometry, point: VehiclePoint) {
  let bestDistance = 0;
  let bestGap = Infinity;
  const longitudeScale = Math.cos((point[1] * Math.PI) / 180);
  for (let index = 1; index < geometry.coordinates.length; index++) {
    const a = geometry.coordinates[index - 1];
    const b = geometry.coordinates[index];
    const dx = (b[0] - a[0]) * longitudeScale;
    const dy = b[1] - a[1];
    const denominator = dx * dx + dy * dy;
    const fraction = denominator
      ? Math.max(
          0,
          Math.min(
            1,
            ((point[0] - a[0]) * longitudeScale * dx + (point[1] - a[1]) * dy) / denominator,
          ),
        )
      : 0;
    const projected: VehiclePoint = [
      a[0] + (b[0] - a[0]) * fraction,
      a[1] + (b[1] - a[1]) * fraction,
    ];
    const gap = distanceMeters(projected, point);
    if (gap < bestGap) {
      bestGap = gap;
      bestDistance =
        geometry.cumulativeMeters[index - 1] +
        fraction * (geometry.cumulativeMeters[index] - geometry.cumulativeMeters[index - 1]);
    }
  }
  return { distance: bestDistance, gap: bestGap };
}

export function unitRouteProgress(id: string, time: number, motions: DemoUnitMotions) {
  const unit = PATROL_UNITS.find((candidate) => candidate.id === id);
  if (!unit) return null;
  const safeTime = Number.isFinite(time) ? Math.max(0, time) : 0;
  const motion = motions[id];
  const elapsed = motion ? Math.max(0, safeTime - motion.baseTime) : safeTime;
  const availableTravel = elapsed * unit.speedMps;
  const travelled = motion?.held
    ? 0
    : motion?.response
      ? Math.min(availableTravel, motion.response.travelMeters)
      : availableTravel;
  const distance = wrapRouteDistance(
    (motion?.baseDistance ?? unit.offsetMeters) + travelled,
    unit.geometry.lengthMeters,
  );
  return {
    unit,
    distance,
    arrived: Boolean(motion?.response && availableTravel >= motion.response.travelMeters),
  };
}

export function sampleDemoVehicle(
  id: string,
  time: number,
  motions: DemoUnitMotions,
): VehiclePosition {
  const original = vehicleAt(id, time);
  const motion = motions[id];
  const progress = unitRouteProgress(id, time, motions);
  if (!motion || !progress) return original;
  const { unit, distance, arrived } = progress;
  return {
    ...original,
    point: pointAtDistance(unit.geometry, distance),
    heading: bearingDegrees(
      pointAtDistance(unit.geometry, wrapRouteDistance(distance - 3, unit.geometry.lengthMeters)),
      pointAtDistance(unit.geometry, wrapRouteDistance(distance + 3, unit.geometry.lengthMeters)),
    ),
    speedMps: arrived || motion.held ? 0 : unit.speedMps,
    emergency: Boolean(motion.response),
  };
}

export function chooseDemoResponders(
  point: VehiclePoint,
  time: number,
  motions: DemoUnitMotions,
  unavailableIds: readonly string[],
) {
  const unavailable = new Set(unavailableIds);
  return PATROL_UNITS.flatMap((unit) => {
    if (motions[unit.id]?.response || motions[unit.id]?.held || unavailable.has(unit.id)) return [];
    const progress = unitRouteProgress(unit.id, time, motions);
    if (!progress || unit.geometry.lengthMeters <= 0) return [];
    const nearbyDistance = distanceMeters(pointAtDistance(unit.geometry, progress.distance), point);
    if (nearbyDistance > HOTSPOT_NEARBY_METERS) return [];
    const staging = nearestRoadPoint(unit.geometry, point);
    if (staging.gap > HOTSPOT_STAGING_METERS) return [];
    return [
      {
        unit,
        nearbyDistance,
        baseDistance: progress.distance,
        stagingGapMeters: staging.gap,
        travelMeters: wrapRouteDistance(
          staging.distance - progress.distance,
          unit.geometry.lengthMeters,
        ),
      },
    ];
  })
    .sort((a, b) => a.nearbyDistance - b.nearbyDistance)
    .slice(0, HOTSPOT_MAX_RESPONDERS);
}
