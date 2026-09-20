import type { GeoJSONSourceSpecification } from "mapbox-gl";
import {
  bearingDegrees,
  pointAtDistance,
  prepareRouteGeometry,
  type VehicleRoute,
} from "./vehicleMotion";

const ROUTE_COLORS = ["#2463eb", "#008575", "#b54d18", "#8055d9", "#c03872"];

export function patrolRouteColor(index: number) {
  return ROUTE_COLORS[index % ROUTE_COLORS.length];
}

export type PresentedRoute = { route: VehicleRoute; color: string; selected: boolean };
type RouteFeatures = Extract<GeoJSONSourceSpecification["data"], { type: "FeatureCollection" }>;
const geometries = new WeakMap<VehicleRoute, ReturnType<typeof prepareRouteGeometry>>();

/** Screen-spaced chevrons follow the supplied street geometry, including bends. */
export function routeChevrons(routes: PresentedRoute[], zoom: number): RouteFeatures {
  const features: RouteFeatures["features"] = [];
  for (const { route, color, selected } of routes) {
    let geometry = geometries.get(route);
    if (!geometry) {
      geometry = prepareRouteGeometry(route.coordinates);
      geometries.set(route, geometry);
    }
    if (geometry.lengthMeters <= 0) continue;
    const latitude = geometry.coordinates[0][1];
    const metersPerPixel = (156543.03392 * Math.cos((latitude * Math.PI) / 180)) / 2 ** zoom;
    const spacing = Math.max(metersPerPixel * 80, geometry.lengthMeters / 100);
    const size = metersPerPixel * (selected ? 5 : 4);
    for (let distance = spacing / 2; distance < geometry.lengthMeters - size; distance += spacing) {
      const back = pointAtDistance(geometry, Math.max(0, distance - size));
      const tip = pointAtDistance(geometry, distance + size);
      const bearing = (bearingDegrees(back, tip) * Math.PI) / 180;
      const wing = size * 0.8;
      const east = (Math.cos(bearing) * wing) / (111320 * Math.cos((back[1] * Math.PI) / 180));
      const north = (-Math.sin(bearing) * wing) / 111320;
      features.push({
        type: "Feature",
        properties: { color, selected, unit: route.unitId },
        geometry: {
          type: "LineString",
          coordinates: [[back[0] + east, back[1] + north], tip, [back[0] - east, back[1] - north]],
        },
      });
    }
  }
  return { type: "FeatureCollection", features };
}
