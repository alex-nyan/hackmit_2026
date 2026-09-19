import type { Map as MapboxMap } from "mapbox-gl";
import { describe, expect, it, vi } from "vitest";
import { add3DBuildings, basemapStyle, isBuildingMapReady } from "./buildingLayer";

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
    expect(layer.paint["fill-extrusion-color"]).toBe("#d2cec5");
  });

  it("retains the original dark building color", () => {
    const map = fakeMap();
    add3DBuildings(map as unknown as MapboxMap, "dark");
    expect(map.addLayer.mock.calls[0][0].paint["fill-extrusion-color"]).toBe("#81939b");
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
