import type { Map as MapboxMap } from "mapbox-gl";
import { describe, expect, it, vi } from "vitest";
import {
  SELECTED_BUILDING_COLOR,
  add3DBuildings,
  basemapStyle,
  clearSelectedBuilding,
  isBuildingMapReady,
  setSelectedBuilding,
} from "./buildingLayer";

function fakeMap() {
  return {
    getLayer: vi.fn().mockReturnValue(undefined),
    getSource: vi.fn().mockReturnValue({}),
    getStyle: vi.fn().mockReturnValue({
      layers: [
        { id: "roads", type: "line" },
        { id: "place-labels", type: "symbol", layout: { "text-field": "name" } },
      ],
    }),
    isSourceLoaded: vi.fn().mockReturnValue(true),
    addLayer: vi.fn(),
  };
}

describe("3D building layer contract", () => {
  it("uses the original Mapbox styles", () => {
    expect(basemapStyle("light")).toBe("mapbox://styles/mapbox/light-v11");
    expect(basemapStyle("dark")).toBe("mapbox://styles/mapbox/dark-v11");
  });

  it("uses real building heights and inserts buildings below labels", () => {
    const map = fakeMap();
    add3DBuildings(map as unknown as MapboxMap, "light");
    const [layer, before] = map.addLayer.mock.calls[0];
    expect(before).toBe("place-labels");
    expect(layer).toMatchObject({
      id: "3d-buildings",
      source: "composite",
      "source-layer": "building",
      type: "fill-extrusion",
      minzoom: 15,
      filter: ["==", ["get", "extrude"], "true"],
    });
    expect(layer.paint["fill-extrusion-height"]).toEqual([
      "interpolate",
      ["linear"],
      ["zoom"],
      15,
      0,
      15.05,
      ["get", "height"],
    ]);
    expect(layer.paint["fill-extrusion-base"]).toEqual([
      "interpolate",
      ["linear"],
      ["zoom"],
      15,
      0,
      15.05,
      ["get", "min_height"],
    ]);
    // Colour is an expression now, but the unselected branch is the original.
    expect(layer.paint["fill-extrusion-color"]).toEqual([
      "case",
      ["boolean", ["feature-state", "selected"], false],
      SELECTED_BUILDING_COLOR,
      "#d2cec5",
    ]);
  });

  it("retains the original dark building color", () => {
    const map = fakeMap();
    add3DBuildings(map as unknown as MapboxMap, "dark");
    const color = map.addLayer.mock.calls[0][0].paint["fill-extrusion-color"];
    expect(color[3]).toBe("#81939b");
    expect(color[2]).toBe(SELECTED_BUILDING_COLOR);
  });

  it("adds depth without touching the height data", () => {
    const map = fakeMap();
    add3DBuildings(map as unknown as MapboxMap, "light");
    const [layer] = map.addLayer.mock.calls[0];

    expect(layer.paint["fill-extrusion-ambient-occlusion-intensity"]).toBeGreaterThan(0);
    expect(layer.paint["fill-extrusion-ambient-occlusion-radius"]).toBeGreaterThan(0);
    expect(layer.paint["fill-extrusion-vertical-gradient"]).toBe(true);
    // edge-radius is a layout property, not paint.
    expect(layer.layout["fill-extrusion-edge-radius"]).toBeGreaterThan(0);
    expect(layer.paint["fill-extrusion-height"]).toEqual([
      "interpolate",
      ["linear"],
      ["zoom"],
      15,
      0,
      15.05,
      ["get", "height"],
    ]);
  });

  it("shades dark buildings more strongly than light ones", () => {
    const light = fakeMap();
    const dark = fakeMap();
    add3DBuildings(light as unknown as MapboxMap, "light");
    add3DBuildings(dark as unknown as MapboxMap, "dark");
    const intensity = (map: ReturnType<typeof fakeMap>) =>
      map.addLayer.mock.calls[0][0].paint["fill-extrusion-ambient-occlusion-intensity"];
    expect(intensity(dark)).toBeGreaterThan(intensity(light));
  });

  it("does not register duplicate building layers", () => {
    const map = fakeMap();
    map.getLayer.mockReturnValue({});
    add3DBuildings(map as unknown as MapboxMap, "light");
    expect(map.addLayer).not.toHaveBeenCalled();
  });

  it("fails explicitly for an incompatible basemap", () => {
    const map = fakeMap();
    map.getSource.mockReturnValue(undefined);
    expect(() => add3DBuildings(map as unknown as MapboxMap, "light")).toThrow(
      "compatible building source",
    );
  });

  it("moves the highlight through feature state", () => {
    const map = { setFeatureState: vi.fn() };
    setSelectedBuilding(map as unknown as MapboxMap, 17);
    expect(map.setFeatureState).toHaveBeenCalledWith(
      { source: "composite", sourceLayer: "building", id: 17 },
      { selected: true },
    );

    map.setFeatureState.mockClear();
    clearSelectedBuilding(map as unknown as MapboxMap, 17);
    expect(map.setFeatureState).toHaveBeenCalledWith(
      { source: "composite", sourceLayer: "building", id: 17 },
      { selected: false },
    );
  });

  it("does nothing when there is no feature to highlight or clear", () => {
    const map = { setFeatureState: vi.fn() };
    setSelectedBuilding(map as unknown as MapboxMap, null);
    clearSelectedBuilding(map as unknown as MapboxMap, null);
    expect(map.setFeatureState).not.toHaveBeenCalled();
  });

  it("requires both the layer and loaded source tiles to report ready", () => {
    const map = fakeMap();
    expect(isBuildingMapReady(map as unknown as MapboxMap)).toBe(false);
    map.getLayer.mockReturnValue({});
    expect(isBuildingMapReady(map as unknown as MapboxMap)).toBe(true);
    map.isSourceLoaded.mockReturnValue(false);
    expect(isBuildingMapReady(map as unknown as MapboxMap)).toBe(false);
    map.getSource.mockReturnValue(undefined);
    map.isSourceLoaded.mockClear();
    expect(isBuildingMapReady(map as unknown as MapboxMap)).toBe(false);
    expect(map.isSourceLoaded).not.toHaveBeenCalled();
  });
});
