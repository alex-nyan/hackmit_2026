import type { ExpressionSpecification, Map as MapboxMap } from "mapbox-gl";
import type { MapTheme } from "./types";

/**
 * The Mapbox light/dark basemaps draw land, water and parks in the same few
 * greys, so the Charles reads as just another block and the Common disappears
 * into the pavement. These repaints put the natural features back in colour:
 * water blue, anything planted green, everything built neutral.
 *
 * Layer ids come from the Mapbox Streets v8 schema that both basemaps share;
 * each repaint is guarded, so a style without a layer is skipped rather than
 * fatal.
 */
const LAND_LAYERS = ["land", "land-structure-polygon"];
const WATER_LAYER = "water";
const WATERWAY_LAYER = "waterway";
const LANDUSE_LAYER = "landuse";
const NATIONAL_PARK_LAYER = "national-park";

/** Ground the colour sits on: warm paper by day, the app's night blue by dark. */
const LAND: Record<MapTheme, string> = { light: "#f6f1e5", dark: "#1b2036" };

/** Open water — harbour, basin, the Charles where it is wide enough to fill. */
const WATER: Record<MapTheme, string> = { light: "#6ec6ea", dark: "#0f4f73" };

/** Rivers and canals too narrow to be a polygon, drawn a shade deeper. */
const WATERWAY: Record<MapTheme, string> = { light: "#3ea7d8", dark: "#1c7fae" };

/**
 * One `landuse` layer carries parks, woods, ballfields and runways alike, so
 * greenery is chosen per class: planted things get green, the rest stays out
 * of the way.
 */
type Greenery = {
  wood: string;
  park: string;
  grass: string;
  scrub: string;
  pitch: string;
  agriculture: string;
  sand: string;
  /** Airports, car parks and the other built classes the layer also carries. */
  built: string;
};

const GREENERY: Record<MapTheme, Greenery> = {
  light: {
    wood: "#7fc389",
    park: "#a3daa4",
    grass: "#bae5b2",
    scrub: "#c4dfa6",
    pitch: "#8ad9a2",
    agriculture: "#dde4a3",
    sand: "#f0e2b6",
    built: "#e6e0d2",
  },
  dark: {
    wood: "#14482e",
    park: "#1d5636",
    grass: "#236240",
    scrub: "#2a5c39",
    pitch: "#1f6b45",
    agriculture: "#3e4a27",
    sand: "#4a4030",
    built: "#252a44",
  },
};

function greeneryColor(theme: MapTheme): ExpressionSpecification {
  const tone = GREENERY[theme];
  return [
    "match",
    ["get", "class"],
    "wood",
    tone.wood,
    "park",
    tone.park,
    "grass",
    tone.grass,
    "scrub",
    tone.scrub,
    "pitch",
    tone.pitch,
    "agriculture",
    tone.agriculture,
    "sand",
    tone.sand,
    tone.built,
  ];
}

/**
 * Recolours the basemap's land, water and greenery for the given theme. Paint
 * properties are lost whenever Mapbox swaps the style, so call this from every
 * `style.load`, alongside the building layer.
 */
export function paintNaturalFeatures(map: MapboxMap, theme: MapTheme) {
  const paint = (
    layer: string,
    property: "background-color" | "fill-color" | "line-color",
    value: string | ExpressionSpecification,
  ) => {
    if (map.getLayer(layer)) map.setPaintProperty(layer, property, value);
  };

  for (const layer of LAND_LAYERS) {
    // `land` is the background layer; the structure polygon is a fill over it.
    paint(layer, layer === "land" ? "background-color" : "fill-color", LAND[theme]);
  }
  paint(WATER_LAYER, "fill-color", WATER[theme]);
  paint(WATERWAY_LAYER, "line-color", WATERWAY[theme]);
  paint(LANDUSE_LAYER, "fill-color", greeneryColor(theme));
  paint(NATIONAL_PARK_LAYER, "fill-color", GREENERY[theme].wood);
}
