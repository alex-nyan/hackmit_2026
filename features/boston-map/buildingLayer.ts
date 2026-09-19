import type { Map as MapboxMap } from "mapbox-gl";
import type { MapTheme } from "./types";

export function basemapStyle(theme: MapTheme) {
  return `mapbox://styles/mapbox/${theme === "dark" ? "dark-v11" : "light-v11"}`;
}

export function add3DBuildings(map: MapboxMap, theme: MapTheme) {
  if (map.getLayer("3d-buildings")) return;
  if (!map.getSource("composite")) {
    throw new Error("The map style has no compatible building source.");
  }

  const firstLabelLayer = map
    .getStyle()
    .layers?.find((layer) => layer.type === "symbol" && layer.layout?.["text-field"]);

  map.addLayer(
    {
      id: "3d-buildings",
      source: "composite",
      "source-layer": "building",
      type: "fill-extrusion",
      minzoom: 15,
      filter: ["==", ["get", "extrude"], "true"],
      paint: {
        "fill-extrusion-color": theme === "dark" ? "#81939b" : "#d2cec5",
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
        "fill-extrusion-opacity": 0.88,
        "fill-extrusion-vertical-gradient": true,
      },
    },
    firstLabelLayer?.id,
  );
}

/** Ready means the building layer and the visible source tiles are available. */
export function isBuildingMapReady(map: MapboxMap): boolean {
  return Boolean(
    map.getStyle() &&
    map.getLayer("3d-buildings") &&
    map.getSource("composite") &&
    map.isSourceLoaded("composite"),
  );
}
