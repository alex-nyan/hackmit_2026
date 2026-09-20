import type { Map as MapboxMap } from "mapbox-gl";
import { describe, expect, it, vi } from "vitest";

import {
  FRESHNESS_COLOR,
  LIVE_ACCURACY_LAYER_ID,
  LIVE_LABEL_LAYER_ID,
  LIVE_POINT_LAYER_ID,
  LIVE_SOURCE_ID,
  addLiveLayers,
  buildLiveGeoJson,
  removeLiveLayers,
  updateLiveLayers,
  type LiveFeature,
} from "./liveLayer";
import type { LiveDevice, LiveFix } from "./types";

function fix(overrides: Partial<LiveFix> = {}): LiveFix {
  return {
    longitude: -71.09692,
    latitude: 42.35849,
    accuracyMeters: 9.6,
    speedKmh: 0,
    headingDegrees: 0,
    fixedAt: "2026-09-19T20:11:32.000Z",
    ageSeconds: 12,
    freshness: "live",
    ...overrides,
  };
}

function device(overrides: Partial<LiveDevice> = {}): LiveDevice {
  return { id: "1", name: "Unit 1", online: true, fix: fix(), ...overrides };
}

function fakeMap(existing: { source?: boolean; layers?: string[] } = {}) {
  const layers = new Set(existing.layers ?? []);
  return {
    getSource: vi.fn(() => (existing.source ? { setData: vi.fn() } : undefined)),
    getLayer: vi.fn((id: string) => (layers.has(id) ? { id } : undefined)),
    addSource: vi.fn(),
    addLayer: vi.fn(),
    removeLayer: vi.fn(),
    removeSource: vi.fn(),
  };
}

describe("live position geometry", () => {
  it("is empty with no devices", () => {
    expect(buildLiveGeoJson([])).toEqual({ type: "FeatureCollection", features: [] });
  });

  it("draws every device that has a fix", () => {
    const collection = buildLiveGeoJson([
      device({ id: "1", name: "Unit 1" }),
      device({ id: "2", name: "Unit 2" }),
    ]);
    const points = collection.features.filter(
      (feature: LiveFeature) => feature.properties.kind === "device",
    );
    expect(points).toHaveLength(2);
    expect(points.map((feature: LiveFeature) => feature.properties.name)).toEqual([
      "Unit 1",
      "Unit 2",
    ]);
    expect(points.map((feature: LiveFeature) => feature.properties.deviceId)).toEqual(["1", "2"]);
  });

  it("skips devices that have no fix instead of placing them at zero", () => {
    const collection = buildLiveGeoJson([
      device({ id: "1" }),
      device({ id: "2", name: "Unit 2", fix: null }),
    ]);
    const ids = collection.features
      .filter((feature: LiveFeature) => feature.properties.kind === "device")
      .map((feature: LiveFeature) => feature.properties.deviceId);
    expect(ids).toEqual(["1"]);
  });

  it("pairs each device with its own accuracy ring", () => {
    const collection = buildLiveGeoJson([
      device({ id: "1" }),
      device({ id: "2", fix: fix({ accuracyMeters: null }) }),
    ]);
    const rings = collection.features.filter(
      (feature: LiveFeature) => feature.properties.kind === "accuracy",
    );
    expect(rings).toHaveLength(1);
    expect(rings[0].properties.deviceId).toBe("1");
  });

  it("uses green only for a live fix", () => {
    expect(FRESHNESS_COLOR.live).toBe("#22c55e");
    expect(FRESHNESS_COLOR.stale).not.toBe(FRESHNESS_COLOR.live);
    expect(FRESHNESS_COLOR.lost).not.toBe(FRESHNESS_COLOR.live);
    expect(FRESHNESS_COLOR.stale).not.toBe(FRESHNESS_COLOR.lost);
  });

  it("colours each device by its own freshness", () => {
    const collection = buildLiveGeoJson([
      device({ id: "1", fix: fix({ freshness: "live" }) }),
      device({ id: "2", fix: fix({ freshness: "stale" }) }),
      device({ id: "3", fix: fix({ freshness: "lost" }) }),
    ]);
    const colors = collection.features
      .filter((feature: LiveFeature) => feature.properties.kind === "device")
      .map((feature: LiveFeature) => feature.properties.color);
    expect(colors).toEqual([FRESHNESS_COLOR.live, FRESHNESS_COLOR.stale, FRESHNESS_COLOR.lost]);
  });
});

describe("live layer lifecycle", () => {
  it("registers the source, both shape layers and the name labels", () => {
    const map = fakeMap();
    addLiveLayers(map as unknown as MapboxMap, "light");

    expect(map.addSource).toHaveBeenCalledWith(LIVE_SOURCE_ID, {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
    expect(map.addLayer.mock.calls.map(([layer]) => layer.id)).toEqual([
      LIVE_ACCURACY_LAYER_ID,
      LIVE_POINT_LAYER_ID,
      LIVE_LABEL_LAYER_ID,
    ]);
  });

  it("labels units in a colour that suits the theme", () => {
    const light = fakeMap();
    const dark = fakeMap();
    addLiveLayers(light as unknown as MapboxMap, "light");
    addLiveLayers(dark as unknown as MapboxMap, "dark");

    const labelPaint = (map: ReturnType<typeof fakeMap>) =>
      map.addLayer.mock.calls.find(([layer]) => layer.id === LIVE_LABEL_LAYER_ID)![0].paint;
    expect(labelPaint(light)["text-color"]).not.toBe(labelPaint(dark)["text-color"]);
  });

  it("is safe to call again after a style swap", () => {
    const map = fakeMap({
      source: true,
      layers: [LIVE_ACCURACY_LAYER_ID, LIVE_POINT_LAYER_ID, LIVE_LABEL_LAYER_ID],
    });
    addLiveLayers(map as unknown as MapboxMap, "light");
    expect(map.addSource).not.toHaveBeenCalled();
    expect(map.addLayer).not.toHaveBeenCalled();
  });

  it("updates through setData rather than replacing the source", () => {
    const setData = vi.fn();
    const map = { getSource: vi.fn(() => ({ setData })), addSource: vi.fn() };
    updateLiveLayers(map as unknown as MapboxMap, [device()]);
    expect(setData).toHaveBeenCalledTimes(1);
    expect(map.addSource).not.toHaveBeenCalled();
  });

  it("ignores updates before the source exists", () => {
    const map = fakeMap();
    expect(() => updateLiveLayers(map as unknown as MapboxMap, [device()])).not.toThrow();
  });

  it("removes layers before the source they depend on", () => {
    const order: string[] = [];
    const map = {
      getLayer: vi.fn((id: string) => ({ id })),
      getSource: vi.fn(() => ({})),
      removeLayer: vi.fn((id: string) => order.push(`layer:${id}`)),
      removeSource: vi.fn((id: string) => order.push(`source:${id}`)),
    };
    removeLiveLayers(map as unknown as MapboxMap);
    expect(order).toEqual([
      `layer:${LIVE_LABEL_LAYER_ID}`,
      `layer:${LIVE_POINT_LAYER_ID}`,
      `layer:${LIVE_ACCURACY_LAYER_ID}`,
      `source:${LIVE_SOURCE_ID}`,
    ]);
  });
});
