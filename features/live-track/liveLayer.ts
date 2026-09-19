import type { ExpressionSpecification, Map as MapboxMap } from "mapbox-gl";

import { accuracyRing } from "./position";
import type { FixFreshness, LiveDevice } from "./types";
import type { MapTheme } from "@/features/boston-map/types";

export const LIVE_SOURCE_ID = "live-position";
export const LIVE_ACCURACY_LAYER_ID = "live-position-accuracy";
export const LIVE_POINT_LAYER_ID = "live-position-point";
export const LIVE_LABEL_LAYER_ID = "live-position-label";

/**
 * Minimal GeoJSON shapes. `@types/geojson` is not a dependency of this project,
 * so the few structures this layer emits are described here instead.
 */
export type LivePointGeometry = { type: "Point"; coordinates: [number, number] };
export type LivePolygonGeometry = { type: "Polygon"; coordinates: [number, number][][] };

export interface LiveFeature {
  type: "Feature";
  properties: Record<string, unknown>;
  geometry: LivePointGeometry | LivePolygonGeometry;
}

export interface LiveFeatureCollection {
  type: "FeatureCollection";
  features: LiveFeature[];
}

const EMPTY: LiveFeatureCollection = { type: "FeatureCollection", features: [] };

/**
 * Freshness drives colour, so a stale position can never be mistaken for a
 * current one. Only a fix under 90 seconds old is green.
 */
export const FRESHNESS_COLOR: Record<FixFreshness, string> = {
  live: "#22c55e",
  stale: "#e0821d",
  lost: "#8a8f98",
};

export function buildLiveGeoJson(devices: LiveDevice[]): LiveFeatureCollection {
  const features: LiveFeature[] = [];

  for (const device of devices) {
    if (!device.fix) continue;
    const { fix } = device;
    const color = FRESHNESS_COLOR[fix.freshness];

    if (fix.accuracyMeters !== null && fix.accuracyMeters > 0) {
      features.push({
        type: "Feature",
        properties: { kind: "accuracy", deviceId: device.id, color },
        geometry: {
          type: "Polygon",
          coordinates: [accuracyRing(fix.longitude, fix.latitude, fix.accuracyMeters)],
        },
      });
    }

    features.push({
      type: "Feature",
      properties: {
        kind: "device",
        deviceId: device.id,
        name: device.name,
        color,
        freshness: fix.freshness,
      },
      geometry: { type: "Point", coordinates: [fix.longitude, fix.latitude] },
    });
  }

  return { type: "FeatureCollection", features };
}

/** Accuracy rings stack up with a fleet, so they fade as more overlap. */
const ACCURACY_OPACITY: ExpressionSpecification = [
  "interpolate",
  ["linear"],
  ["zoom"],
  12,
  0.08,
  16,
  0.16,
];

/**
 * Adds the source and layers above the 3D buildings. Mapbox drops custom layers
 * whenever the style is replaced, so this must be safe to call again on
 * `style.load` and must not disturb the building extrusions.
 */
export function addLiveLayers(map: MapboxMap, theme: MapTheme) {
  if (!map.getSource(LIVE_SOURCE_ID)) {
    map.addSource(LIVE_SOURCE_ID, {
      type: "geojson",
      data: EMPTY,
    } as Parameters<MapboxMap["addSource"]>[1]);
  }

  if (!map.getLayer(LIVE_ACCURACY_LAYER_ID)) {
    map.addLayer({
      id: LIVE_ACCURACY_LAYER_ID,
      type: "fill",
      source: LIVE_SOURCE_ID,
      filter: ["==", ["get", "kind"], "accuracy"],
      paint: {
        "fill-color": ["get", "color"],
        "fill-opacity": ACCURACY_OPACITY,
      },
    });
  }

  if (!map.getLayer(LIVE_POINT_LAYER_ID)) {
    map.addLayer({
      id: LIVE_POINT_LAYER_ID,
      type: "circle",
      source: LIVE_SOURCE_ID,
      filter: ["==", ["get", "kind"], "device"],
      paint: {
        "circle-radius": 7,
        "circle-color": ["get", "color"],
        "circle-stroke-width": 2.5,
        "circle-stroke-color": "#ffffff",
      },
    });
  }

  if (!map.getLayer(LIVE_LABEL_LAYER_ID)) {
    // Names matter once there is more than one unit on the map.
    map.addLayer({
      id: LIVE_LABEL_LAYER_ID,
      type: "symbol",
      source: LIVE_SOURCE_ID,
      filter: ["==", ["get", "kind"], "device"],
      layout: {
        "text-field": ["get", "name"],
        "text-font": ["DIN Offc Pro Medium", "Arial Unicode MS Regular"],
        "text-size": 12,
        "text-offset": [0, 1.3],
        "text-anchor": "top",
        "text-allow-overlap": false,
      },
      paint: {
        "text-color": theme === "dark" ? "#edf2f3" : "#10202a",
        "text-halo-color": theme === "dark" ? "rgba(17,27,34,0.85)" : "rgba(255,255,255,0.9)",
        "text-halo-width": 1.4,
      },
    });
  }
}

export function updateLiveLayers(map: MapboxMap, devices: LiveDevice[]) {
  const source = map.getSource(LIVE_SOURCE_ID) as
    { setData?: (data: LiveFeatureCollection) => void } | undefined;
  if (typeof source?.setData !== "function") return;
  source.setData(buildLiveGeoJson(devices));
}

export function removeLiveLayers(map: MapboxMap) {
  [LIVE_LABEL_LAYER_ID, LIVE_POINT_LAYER_ID, LIVE_ACCURACY_LAYER_ID].forEach((id) => {
    if (map.getLayer(id)) map.removeLayer(id);
  });
  if (map.getSource(LIVE_SOURCE_ID)) map.removeSource(LIVE_SOURCE_ID);
}
