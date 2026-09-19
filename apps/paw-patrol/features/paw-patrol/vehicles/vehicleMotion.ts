import streetRoutes from "./street-routes.json";

export type VehiclePoint = [number, number];
export type VehicleRouteKind = "patrol" | "response" | "transport";
export type VehicleRoute = {
  id: string;
  unitId: string;
  kind: VehicleRouteKind;
  startTime: number;
  endTime: number;
  coordinates: VehiclePoint[];
  roadNames: string[];
};
export type RouteGeometry = {
  coordinates: VehiclePoint[];
  cumulativeMeters: number[];
  lengthMeters: number;
};
export type VehiclePosition = {
  point: VehiclePoint;
  /** Degrees clockwise from geographic north, not screen bearing. */
  heading: number;
  speedMps: number;
  /** Route-level street names; the source does not provide per-vertex names. */
  roadName: string;
  routeId: string;
  emergency: boolean;
};

const RADIANS = Math.PI / 180;
const EARTH_RADIUS_METERS = 6_371_008.8;
const FALLBACK: VehiclePoint = [-71.090794, 42.362764];

function validPoint(value: unknown): value is VehiclePoint {
  return Array.isArray(value) && value.length === 2 &&
    typeof value[0] === "number" && Number.isFinite(value[0]) && Math.abs(value[0]) <= 180 &&
    typeof value[1] === "number" && Number.isFinite(value[1]) && Math.abs(value[1]) <= 90;
}

export function distanceMeters(a: readonly number[], b: readonly number[]): number {
  const lat = (b[1] - a[1]) * RADIANS;
  const lng = (b[0] - a[0]) * RADIANS;
  const h = Math.sin(lat / 2) ** 2 + Math.cos(a[1] * RADIANS) *
    Math.cos(b[1] * RADIANS) * Math.sin(lng / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))));
}

/** Invalid vertices reject the whole path: never bridge across missing geometry. */
export function prepareRouteGeometry(points: readonly VehiclePoint[]): RouteGeometry {
  const coordinates: VehiclePoint[] = [];
  if (!points.every(validPoint)) return { coordinates, cumulativeMeters: [], lengthMeters: 0 };
  for (const point of points) {
    const previous = coordinates.at(-1);
    if (!previous || distanceMeters(previous, point) > 0.0001) coordinates.push([...point]);
  }
  const cumulativeMeters = coordinates.length ? [0] : [];
  for (let i = 1; i < coordinates.length; i++) {
    cumulativeMeters.push(cumulativeMeters[i - 1] + distanceMeters(coordinates[i - 1], coordinates[i]));
  }
  return { coordinates, cumulativeMeters, lengthMeters: cumulativeMeters.at(-1) ?? 0 };
}

/** Position interpolation stays on each supplied road segment, never a smoothed corner. */
export function pointAtDistance(geometry: RouteGeometry, meters: number): VehiclePoint {
  const { coordinates, cumulativeMeters, lengthMeters } = geometry;
  if (!coordinates.length) return [...FALLBACK];
  if (coordinates.length === 1 || lengthMeters <= 0) return [...coordinates[0]];
  const distance = Number.isFinite(meters) ? Math.min(lengthMeters, Math.max(0, meters)) : 0;
  if (distance >= lengthMeters) return [...coordinates[coordinates.length - 1]];
  let low = 1;
  let high = cumulativeMeters.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (cumulativeMeters[middle] < distance) low = middle + 1;
    else high = middle;
  }
  const span = cumulativeMeters[low] - cumulativeMeters[low - 1];
  const fraction = span > 0 ? (distance - cumulativeMeters[low - 1]) / span : 0;
  const start = coordinates[low - 1];
  const end = coordinates[low];
  return [start[0] + (end[0] - start[0]) * fraction, start[1] + (end[1] - start[1]) * fraction];
}

export function bearingDegrees(from: VehiclePoint, to: VehiclePoint): number {
  if (from[0] === to[0] && from[1] === to[1]) return 0;
  const longitude = (to[0] - from[0]) * RADIANS;
  const a = from[1] * RADIANS;
  const b = to[1] * RADIANS;
  const y = Math.sin(longitude) * Math.cos(b);
  const x = Math.cos(a) * Math.sin(b) - Math.sin(a) * Math.cos(b) * Math.cos(longitude);
  return (Math.atan2(y, x) / RADIANS + 360) % 360;
}

/** Only orientation is softened across a 6 m tangent window; road positions are exact. */
export function headingAtDistance(geometry: RouteGeometry, meters: number): number {
  if (!geometry.lengthMeters) return 0;
  const distance = Number.isFinite(meters) ? Math.min(geometry.lengthMeters, Math.max(0, meters)) : 0;
  return bearingDegrees(
    pointAtDistance(geometry, Math.max(0, distance - 3)),
    pointAtDistance(geometry, Math.min(geometry.lengthMeters, distance + 3)),
  );
}

/** Short acceleration/deceleration ramps maintain elapsed-time, distance-based movement. */
export function motionAtElapsed(lengthMeters: number, duration: number, elapsed: number) {
  if (!Number.isFinite(lengthMeters) || lengthMeters <= 0 || !Number.isFinite(duration) || duration <= 0) {
    return { distance: 0, speedMps: 0 };
  }
  const time = Number.isFinite(elapsed) ? Math.min(duration, Math.max(0, elapsed)) : 0;
  const ramp = Math.min(2, duration / 4);
  const cruiseSpeed = lengthMeters / (duration - ramp);
  if (time <= 0) return { distance: 0, speedMps: 0 };
  if (time >= duration) return { distance: lengthMeters, speedMps: 0 };
  if (time < ramp) return { distance: cruiseSpeed * time * time / (2 * ramp), speedMps: cruiseSpeed * time / ramp };
  if (time > duration - ramp) {
    const remaining = duration - time;
    return { distance: lengthMeters - cruiseSpeed * remaining * remaining / (2 * ramp), speedMps: cruiseSpeed * remaining / ramp };
  }
  return { distance: cruiseSpeed * (time - ramp / 2), speedMps: cruiseSpeed };
}

export function parseVehicleRoutes(input: unknown): VehicleRoute[] {
  if (!Array.isArray(input)) return [];
  const ids = new Set<string>();
  const result: VehicleRoute[] = [];
  for (const value of input) {
    if (typeof value !== "object" || !value) continue;
    const route = value as Record<string, unknown>;
    if (typeof route.id !== "string" || !route.id || ids.has(route.id) ||
      typeof route.unitId !== "string" || !route.unitId ||
      !["patrol", "response", "transport"].includes(String(route.kind)) ||
      typeof route.startTime !== "number" || !Number.isFinite(route.startTime) || route.startTime < 0 ||
      typeof route.endTime !== "number" || !Number.isFinite(route.endTime) || route.endTime <= route.startTime ||
      !Array.isArray(route.coordinates) || !route.coordinates.length || !route.coordinates.every(validPoint)) continue;
    const geometry = prepareRouteGeometry(route.coordinates);
    ids.add(route.id);
    result.push({
      id: route.id, unitId: route.unitId, kind: route.kind as VehicleRouteKind,
      startTime: route.startTime, endTime: route.endTime, coordinates: geometry.coordinates,
      roadNames: Array.isArray(route.roadNames) ? route.roadNames.filter((name): name is string => typeof name === "string" && !!name) : [],
    });
  }
  return result.sort((a, b) => a.startTime - b.startTime);
}

export const VEHICLE_ROUTES = parseVehicleRoutes(streetRoutes.routes);
export const DEMO_INCIDENT: VehiclePoint = validPoint(streetRoutes.incident) ? [...streetRoutes.incident] : [...FALLBACK];
export const DEMO_DESTINATION: VehiclePoint = validPoint(streetRoutes.receivingPoint) ? [...streetRoutes.receivingPoint] : [...DEMO_INCIDENT];
export const ROUTE_SOURCE = {
  source: streetRoutes.source,
  sourceUrl: streetRoutes.sourceUrl,
  attribution: streetRoutes.attribution,
  attributionUrl: streetRoutes.attributionUrl,
  retrievedAt: streetRoutes.retrievedAt,
  receivingPointLabel: streetRoutes.receivingPointLabel,
  simulated: true,
} as const;
const geometries = new Map(VEHICLE_ROUTES.map((route) => [route.id, prepareRouteGeometry(route.coordinates)]));

/** In a gap, hold the completed leg; before departure, hold the first road vertex. */
export function vehicleRoute(id: string, time: number): VehicleRoute | null {
  const routes = VEHICLE_ROUTES.filter((route) => route.unitId === id);
  const t = Number.isFinite(time) ? Math.min(90, Math.max(0, time)) : 0;
  return routes.findLast((route) => route.startTime <= t) ?? routes[0] ?? null;
}

export function vehicleAt(id: string, time: number): VehiclePosition {
  const t = Number.isFinite(time) ? Math.min(90, Math.max(0, time)) : 0;
  const route = vehicleRoute(id, t);
  if (!route) return { point: [...DEMO_INCIDENT], heading: 0, speedMps: 0, roadName: "Route unavailable", routeId: "", emergency: false };
  const geometry = geometries.get(route.id)!;
  const motion = motionAtElapsed(geometry.lengthMeters, route.endTime - route.startTime, t - route.startTime);
  return {
    point: pointAtDistance(geometry, motion.distance),
    heading: headingAtDistance(geometry, motion.distance),
    speedMps: motion.speedMps,
    roadName: route.roadNames.join(" / ") || "Simulated street route",
    routeId: route.id,
    emergency: t < 90 && ((id === "P-01" && t >= 15) || ((id === "P-02" || id === "P-03") && t >= 30)),
  };
}
