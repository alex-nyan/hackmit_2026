import type { ExpressionSpecification, Map as MapboxMap } from "mapbox-gl";
import type { MapTheme } from "./types";

export const BUILDING_LAYER_ID = "3d-buildings";
export const BUILDING_SOURCE = "composite";
export const BUILDING_SOURCE_LAYER = "building";

/** The app accent, used so a picked building reads against both themes. */
export const SELECTED_BUILDING_COLOR = "#d9502e";

const BASE_COLOR: Record<MapTheme, string> = {
  light: "#d2cec5",
  dark: "#81939b",
};

/** Selected buildings recolour through feature state; everything else is flat. */
function buildingColor(theme: MapTheme): ExpressionSpecification {
  return [
    "case",
    ["boolean", ["feature-state", "selected"], false],
    SELECTED_BUILDING_COLOR,
    BASE_COLOR[theme],
  ];
}

export function basemapStyle(theme: MapTheme) {
  return `mapbox://styles/mapbox/${theme === "dark" ? "dark-v11" : "light-v11"}`;
}

export function add3DBuildings(map: MapboxMap, theme: MapTheme) {
  if (map.getLayer(BUILDING_LAYER_ID)) return;
  if (!map.getSource(BUILDING_SOURCE)) {
    throw new Error("The map style has no compatible building source.");
  }

  const firstLabelLayer = map
    .getStyle()
    .layers?.find((layer) => layer.type === "symbol" && layer.layout?.["text-field"]);

  map.addLayer(
    {
      id: BUILDING_LAYER_ID,
      source: BUILDING_SOURCE,
      "source-layer": BUILDING_SOURCE_LAYER,
      type: "fill-extrusion",
      minzoom: 15,
      layout: {
        // A small bevel catches the vertical gradient and defines each corner.
        // Marked experimental by Mapbox; it degrades to square edges if dropped.
        "fill-extrusion-edge-radius": 0.4,
      },
      filter: ["==", ["get", "extrude"], "true"],
      paint: {
        "fill-extrusion-color": buildingColor(theme),
        "fill-extrusion-height": [
          "interpolate",
          ["linear"],
          ["zoom"],
          15,
          0,
          15.05,
          ["get", "height"],
        ],
        "fill-extrusion-base": [
          "interpolate",
          ["linear"],
          ["zoom"],
          15,
          0,
          15.05,
          ["get", "min_height"],
        ],
        "fill-extrusion-opacity": 0.94,
        "fill-extrusion-vertical-gradient": true,
        // Contact shadows where walls meet the ground and each other; this is
        // what separates neighbouring blocks instead of one flat silhouette.
        "fill-extrusion-ambient-occlusion-intensity": theme === "dark" ? 0.45 : 0.3,
        "fill-extrusion-ambient-occlusion-radius": 3.5,
      },
    },
    firstLabelLayer?.id,
  );
}

/** Ready means the building layer and the visible source tiles are available. */
export function isBuildingMapReady(map: MapboxMap): boolean {
  return Boolean(
    map.getStyle() &&
    map.getLayer(BUILDING_LAYER_ID) &&
    map.getSource(BUILDING_SOURCE) &&
    map.isSourceLoaded(BUILDING_SOURCE),
  );
}

/**
 * Moves the selection highlight. Passing null clears it. Feature state is
 * discarded whenever Mapbox replaces the style, so the caller must re-apply or
 * clear the selection on `style.load`.
 */
export function setSelectedBuilding(map: MapboxMap, id: string | number | null) {
  const target = { source: BUILDING_SOURCE, sourceLayer: BUILDING_SOURCE_LAYER };
  if (id !== null) {
    map.setFeatureState({ ...target, id }, { selected: true });
  }
}

export function clearSelectedBuilding(map: MapboxMap, id: string | number | null) {
  if (id === null) return;
  map.setFeatureState(
    { source: BUILDING_SOURCE, sourceLayer: BUILDING_SOURCE_LAYER, id },
    { selected: false },
  );
}
