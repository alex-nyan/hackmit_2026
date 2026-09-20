import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OperationsMap, type OperationsMapProps } from "./OperationsMap";
import { MAP_FOCUS } from "../boston-map/types";
import { initialDemo } from "./useScenario";
import { PEOPLE } from "./scenario";
import { SUSPECTS, suspectAt } from "./suspects";
import { vehicleAt } from "./vehicles/vehicleMotion";
import type { PatrolVehicleLayerOptions } from "./vehicles/PatrolVehicleLayer";
import type { LiveDevice } from "@/features/live-track";

type Handler = (data: Record<string, unknown>) => void;
type TestLayer = { id: string; onRemove?: () => void; [key: string]: unknown };
const mocked = vi.hoisted(() => ({
  maps: [] as TestMap[],
  markers: [] as TestMarker[],
  layers: [] as Array<{ options: PatrolVehicleLayerOptions; dispose: ReturnType<typeof vi.fn> }>,
  frames: new Map<number, FrameRequestCallback>(),
  nextFrame: 1,
  supported: vi.fn(() => true),
  disconnect: vi.fn(),
}));

class TestMap {
  handlers = new Map<string, Set<Handler>>();
  layers = new Map<string, TestLayer>();
  sources = new Map<string, { setData: ReturnType<typeof vi.fn> }>([
    ["composite", { setData: vi.fn() }],
  ]);
  zoom = 16.1;
  center = { lng: -71.092, lat: 42.36 };
  addControl = vi.fn();
  flyTo = vi.fn((options: { center?: number[]; zoom?: number }) => {
    if (options.zoom !== undefined) this.zoom = options.zoom;
    if (options.center) this.center = { lng: options.center[0], lat: options.center[1] };
  });
  jumpTo = vi.fn((options: { center?: number[]; zoom?: number }) => {
    if (options.zoom !== undefined) this.zoom = options.zoom;
    if (options.center) this.center = { lng: options.center[0], lat: options.center[1] };
  });
  easeTo = vi.fn();
  stop = vi.fn();
  resize = vi.fn();
  triggerRepaint = vi.fn();
  setPaintProperty = vi.fn();
  setLayoutProperty = vi.fn();
  setFeatureState = vi.fn();
  queryRenderedFeatures = vi.fn((): unknown[] => []);
  remove = vi.fn(() => {
    for (const layer of this.layers.values()) layer.onRemove?.();
    this.layers.clear();
  });
  setStyle = vi.fn(() => {
    for (const layer of this.layers.values()) layer.onRemove?.();
    this.layers.clear();
    this.sources = new Map([["composite", { setData: vi.fn() }]]);
  });
  addLayer = vi.fn((layer: TestLayer) => {
    this.layers.set(layer.id, layer);
  });
  addSource = vi.fn((id: string) => {
    this.sources.set(id, { setData: vi.fn() });
  });
  removeLayer = vi.fn((id: string) => {
    this.layers.get(id)?.onRemove?.();
    this.layers.delete(id);
  });
  constructor(public options: Record<string, unknown>) {
    mocked.maps.push(this);
  }
  getStyle() {
    return { layers: [] };
  }
  getSource(id: string) {
    return this.sources.get(id);
  }
  getLayer(id: string) {
    return this.layers.get(id);
  }
  getZoom() {
    return this.zoom;
  }
  getCenter() {
    return this.center;
  }
  getBearing() {
    return -17.6;
  }
  getPitch() {
    return 45;
  }
  isMoving() {
    return false;
  }
  isStyleLoaded() {
    return true;
  }
  isSourceLoaded() {
    return true;
  }
  getCanvas() {
    return document.createElement("canvas");
  }
  project(point: number[]) {
    return { x: point[0] * 10, y: point[1] * 10 };
  }
  on(event: string, handler: Handler) {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(handler);
    return this;
  }
  off(event: string, handler: Handler) {
    this.handlers.get(event)?.delete(handler);
    return this;
  }
  emit(event: string, data: Record<string, unknown> = {}) {
    for (const handler of this.handlers.get(event) ?? []) handler(data);
  }
}

class TestMarker {
  point: number[] = [];
  setLngLat = vi.fn((point: number[]) => {
    this.point = point;
    return this;
  });
  setOffset = vi.fn(() => this);
  setRotation = vi.fn(() => this);
  setRotationAlignment = vi.fn(() => this);
  setPitchAlignment = vi.fn(() => this);
  remove = vi.fn(() => this.options.element.remove());
  constructor(public options: { element: HTMLElement }) {
    mocked.markers.push(this);
  }
  addTo(map: TestMap) {
    (map.options.container as HTMLElement).append(this.options.element);
    return this;
  }
  getElement() {
    return this.options.element;
  }
}

vi.mock("../boston-map/mapboxClient", () => ({
  loadMapbox: async () => ({
    supported: mocked.supported,
    NavigationControl: class {},
    Map: TestMap,
    Marker: TestMarker,
  }),
}));

vi.mock("./vehicles/PatrolVehicleLayer", () => ({
  VEHICLE_MIN_ZOOM: 16,
  VEHICLE_LAYER_ID: "paw-patrol-vehicles",
  createPatrolVehicleLayer: (options: PatrolVehicleLayerOptions) => {
    const dispose = vi.fn();
    mocked.layers.push({ options, dispose });
    return { id: "paw-patrol-vehicles", type: "custom", renderingMode: "3d", onRemove: dispose };
  },
}));

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN", "pk.unit-test-not-a-real-token");
  mocked.maps.length = 0;
  mocked.markers.length = 0;
  mocked.layers.length = 0;
  mocked.frames.clear();
  mocked.nextFrame = 1;
  mocked.supported.mockReturnValue(true);
  mocked.disconnect.mockClear();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect = mocked.disconnect;
    },
  );
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn((callback: FrameRequestCallback) => {
      const id = mocked.nextFrame++;
      mocked.frames.set(id, callback);
      return id;
    }),
  );
  vi.stubGlobal(
    "cancelAnimationFrame",
    vi.fn((id: number) => {
      mocked.frames.delete(id);
    }),
  );
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const props = (overrides: Partial<OperationsMapProps> = {}): OperationsMapProps => ({
  time: 0,
  running: false,
  readClock: () => initialDemo,
  selectedId: "P-01",
  onSelect: vi.fn(),
  focus: "mit",
  theme: "light",
  recenterKey: 0,
  following: false,
  onStopFollowing: vi.fn(),
  liveDevices: [],
  fixRequest: null,
  onBuildingSelect: vi.fn(),
  ...overrides,
});

async function mount(overrides: Partial<OperationsMapProps> = {}) {
  const current = props(overrides);
  const view = render(<OperationsMap {...current} />);
  await waitFor(() => expect(mocked.maps).toHaveLength(1));
  await waitFor(() => expect(mocked.layers).toHaveLength(1));
  return { ...view, current, map: mocked.maps[0] };
}

function device(name: string, ageSeconds: number): LiveDevice {
  return {
    id: "7",
    name,
    online: true,
    fix: {
      longitude: -71.09,
      latitude: 42.36,
      accuracyMeters: 12,
      speedKmh: 0,
      headingDegrees: null,
      fixedAt: "2026-09-19T12:00:00.000Z",
      ageSeconds,
      freshness: ageSeconds < 90 ? "live" : "stale",
    },
  };
}

function markerFor(element: Element) {
  return mocked.markers.find((marker) => marker.options.element === element)!;
}

function frame(milliseconds = 40) {
  const callbacks = [...mocked.frames.values()];
  mocked.frames.clear();
  act(() => callbacks.forEach((callback) => callback(milliseconds)));
}

describe("patrol map integration", () => {
  it("does not create another map or move the camera just because selection changes", async () => {
    const { map, current, rerender } = await mount();
    map.flyTo.mockClear();
    map.jumpTo.mockClear();
    map.easeTo.mockClear();
    rerender(<OperationsMap {...current} selectedId="P-02" />);
    expect(mocked.maps).toHaveLength(1);
    expect(map.flyTo).not.toHaveBeenCalled();
    expect(map.jumpTo).not.toHaveBeenCalled();
    expect(map.easeTo).not.toHaveBeenCalled();
    const frameData = mocked.layers[0].options.getVehicles();
    expect(frameData.find((vehicle) => vehicle.id === "P-02")?.selected).toBe(true);
    expect(frameData.find((vehicle) => vehicle.id === "P-01")?.selected).toBe(false);
    expect(map.getSource("paw-scenario-route")?.setData).toHaveBeenLastCalledWith(
      expect.objectContaining({
        features: [
          expect.objectContaining({ properties: expect.objectContaining({ unit: "P-02" }) }),
        ],
      }),
    );
  });

  it("uses an explicit recenter or area change for camera movement", async () => {
    const { map, current, rerender } = await mount();
    map.flyTo.mockClear();
    rerender(<OperationsMap {...current} selectedId="P-02" recenterKey={1} />);
    expect(map.flyTo).toHaveBeenLastCalledWith(
      expect.objectContaining({ center: vehicleAt("P-02", 0).point }),
    );
    rerender(<OperationsMap {...current} selectedId="P-02" recenterKey={1} focus="harvard" />);
    expect(map.flyTo).toHaveBeenLastCalledWith(
      expect.objectContaining({ center: MAP_FOCUS.harvard.center }),
    );
  });

  it("only follows on request and lets manual map exploration stop following", async () => {
    let time = 0;
    const onStopFollowing = vi.fn();
    const readClock = () => ({ ...initialDemo, time, running: true });
    const { map, current, rerender } = await mount({ running: true, readClock, onStopFollowing });
    rerender(<OperationsMap {...current} following />);
    expect(map.flyTo).toHaveBeenLastCalledWith(
      expect.objectContaining({ center: vehicleAt("P-01", 0).point }),
    );
    time = 2;
    frame();
    expect(map.jumpTo).toHaveBeenLastCalledWith({ center: vehicleAt("P-01", time).point });
    act(() => map.emit("movestart"));
    expect(onStopFollowing).not.toHaveBeenCalled();
    act(() => map.emit("movestart", { originalEvent: new Event("pointerdown") }));
    expect(onStopFollowing).toHaveBeenCalledOnce();
    rerender(<OperationsMap {...current} following={false} />);
    map.jumpTo.mockClear();
    time = 3;
    frame(80);
    expect(map.jumpTo).not.toHaveBeenCalled();
  });

  it("shares the continuous clock between marker and 3D vehicle positions", async () => {
    let time = 0;
    const readClock = vi.fn(() => ({ ...initialDemo, running: true, time }));
    await mount({ running: true, readClock });
    time = 2.5;
    frame();
    const vehicles = mocked.layers[0].options.getVehicles();
    expect(mocked.layers[0].options.getSeconds()).toBe(2.5);
    for (const person of PEOPLE) {
      const vehicle = vehicles.find((value) => value.id === person.id);
      expect(vehicle?.point).toEqual(vehicleAt(person.id, time).point);
      const marker = mocked.markers.find((value) =>
        value.options.element.textContent?.includes(person.id),
      );
      expect(marker?.point).toEqual(vehicle?.point);
    }
  });

  it("restores one vehicle layer on the existing map after theme changes", async () => {
    const { map, current, rerender } = await mount();
    rerender(<OperationsMap {...current} theme="dark" />);
    expect(map.setStyle).toHaveBeenLastCalledWith("mapbox://styles/mapbox/dark-v11");
    act(() => map.emit("style.load"));
    expect(mocked.maps).toHaveLength(1);
    expect(map.layers.has("paw-patrol-vehicles")).toBe(true);
    expect(mocked.layers[0].dispose).toHaveBeenCalledOnce();
    const count = mocked.layers.length;
    act(() => map.emit("style.load"));
    expect(mocked.layers).toHaveLength(count);
  });

  it("cleans up frame scheduling, marker nodes, listeners and map resources", async () => {
    const { map, unmount } = await mount({
      running: true,
      readClock: () => ({ ...initialDemo, running: true }),
    });
    expect(mocked.frames.size).toBeLessThanOrEqual(1);
    unmount();
    expect(mocked.frames.size).toBe(0);
    expect(map.remove).toHaveBeenCalledOnce();
    expect(mocked.disconnect).toHaveBeenCalledOnce();
    expect([...map.handlers.values()].every((handlers) => handlers.size === 0)).toBe(true);
    for (const marker of mocked.markers) expect(marker.remove).toHaveBeenCalledOnce();
    expect(mocked.layers[0].dispose).toHaveBeenCalledOnce();
  });

  it("cancels unnecessary frames while hidden and when the shared clock stops", async () => {
    let hidden = false;
    let running = true;
    vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
    await mount({ running, readClock: () => ({ ...initialDemo, running }) });
    expect(mocked.frames.size).toBe(1);
    hidden = true;
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(mocked.frames.size).toBe(0);
    running = false;
    hidden = false;
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(mocked.frames.size).toBe(0);
  });

  it("keeps city-level unit markers as selectable labelled native buttons", async () => {
    const onSelect = vi.fn();
    const { map, getByRole } = await mount({ onSelect });
    map.zoom = 13;
    act(() => map.emit("zoom"));
    const marker = getByRole("button", { name: new RegExp(`${PEOPLE[1].name}.*P-02`) });
    expect(marker.tagName).toBe("BUTTON");
    expect(marker.getAttribute("aria-pressed")).toBe("false");
    marker.focus();
    expect(document.activeElement).toBe(marker);
    // Native buttons provide Enter/Space activation; click exercises that same handler.
    fireEvent.click(marker);
    expect(onSelect).toHaveBeenLastCalledWith("P-02");
  });

  it("selects the unit represented by a projected 3D vehicle hit", async () => {
    const onSelect = vi.fn();
    const { map } = await mount({ onSelect });
    const point = map.project(vehicleAt("P-04", 0).point);
    act(() => map.emit("click", { point }));
    expect(onSelect).toHaveBeenLastCalledWith("P-04");
    onSelect.mockClear();
    act(() => map.emit("click", { point: { x: 5000, y: 5000 } }));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("keeps selectable fallback markers if 3D rendering fails while paused", async () => {
    const { getByRole, getByText } = await mount();
    act(() => mocked.layers[0].options.onFailure());
    expect(getByText(/3D vehicles unavailable/)).toBeTruthy();
    const marker = getByRole("button", { name: new RegExp(`${PEOPLE[0].name}.*P-01`) });
    expect(marker.getAttribute("data-detail")).toBe("false");
  });

  it("handles missing map access and unavailable WebGL without orphan resources", async () => {
    vi.stubEnv("NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN", "");
    const view = render(<OperationsMap {...props()} />);
    expect(view.getByRole("alert").textContent).toContain("Configure a public Mapbox token");
    expect(mocked.maps).toHaveLength(0);
    view.unmount();
    vi.stubEnv("NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN", "pk.unit-test-not-a-real-token");
    mocked.supported.mockReturnValue(false);
    const next = render(<OperationsMap {...props()} />);
    await waitFor(() =>
      expect(next.getByRole("alert").textContent).toContain("WebGL is unavailable"),
    );
    expect(mocked.maps).toHaveLength(0);
  });

  it("does not leak a duplicate map under Strict Mode", async () => {
    const view = render(
      <StrictMode>
        <OperationsMap {...props()} />
      </StrictMode>,
    );
    await waitFor(() => expect(mocked.maps).toHaveLength(1));
    view.unmount();
    expect(mocked.maps[0].remove).toHaveBeenCalledOnce();
    expect(mocked.frames.size).toBe(0);
  });

  it("reports a clicked building and clears the selection on an empty click", async () => {
    const onBuildingSelect = vi.fn();
    const { map } = await mount({ onBuildingSelect });
    onBuildingSelect.mockClear();
    map.queryRenderedFeatures.mockReturnValueOnce([
      {
        id: 4821,
        properties: { height: 48.5, min_height: 3 },
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [-71.092, 42.36],
              [-71.0918, 42.36],
              [-71.0918, 42.3602],
              [-71.092, 42.3602],
              [-71.092, 42.36],
            ],
          ],
        },
      },
    ]);

    // Far from every unit, so the click falls through to the building layer.
    act(() => map.emit("click", { point: { x: 5000, y: 5000 } }));
    expect(onBuildingSelect).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 4821, heightM: 48.5, baseM: 3 }),
    );
    expect(map.setFeatureState).toHaveBeenCalledWith(expect.objectContaining({ id: 4821 }), {
      selected: true,
    });

    act(() => map.emit("click", { point: { x: 5000, y: 5000 } }));
    expect(onBuildingSelect).toHaveBeenLastCalledWith(null);
    expect(map.setFeatureState).toHaveBeenCalledWith(expect.objectContaining({ id: 4821 }), {
      selected: false,
    });
  });

  it("selecting a patrol vehicle leaves any building selection alone", async () => {
    const onSelect = vi.fn();
    const onBuildingSelect = vi.fn();
    const { map } = await mount({ onSelect, onBuildingSelect });
    onBuildingSelect.mockClear();
    act(() => map.emit("click", { point: map.project(vehicleAt("P-04", 0).point) }));
    expect(onSelect).toHaveBeenLastCalledWith("P-04");
    expect(onBuildingSelect).not.toHaveBeenCalled();
    expect(map.queryRenderedFeatures).not.toHaveBeenCalled();
  });

  it("beams a green beacon from every officer and a red one from a reported person", async () => {
    let time = 0;
    const readClock = () => ({ ...initialDemo, time, running: true });
    const { container } = await mount({ running: true, readClock });
    const beacons = (kind: string) => [
      ...container.querySelectorAll<HTMLElement>(`[data-kind="${kind}"]`),
    ];
    expect(beacons("officer")).toHaveLength(PEOPLE.length);
    expect(beacons("suspect")).toHaveLength(SUSPECTS.length);
    // Before the report is made, the red beacon is not on the map at all.
    expect(beacons("suspect")[0].hidden).toBe(true);

    time = 30;
    frame();
    const red = beacons("suspect")[0];
    expect(red.hidden).toBe(false);
    expect(markerFor(red).point).toEqual(suspectAt(SUSPECTS[0].id, time)!.point);
    PEOPLE.forEach((person, index) => {
      const green = beacons("officer")[index];
      expect(green.hidden).toBe(false);
      expect(markerFor(green).point).toEqual(vehicleAt(person.id, time).point);
    });
  });

  it("marks the reported person as a report rather than a selectable unit", async () => {
    let time = 30;
    const readClock = () => ({ ...initialDemo, time, running: true });
    const { getByRole, queryByRole } = await mount({ running: true, readClock });
    const chip = getByRole("img", { name: new RegExp(SUSPECTS[0].id) });
    expect(chip.tagName).toBe("DIV");
    expect(chip.textContent).toContain("UNVERIFIED");
    expect(chip.getAttribute("aria-label")).toContain(SUSPECTS[0].source);
    expect(queryByRole("button", { name: new RegExp(SUSPECTS[0].id) })).toBeNull();

    // The report holds its last position rather than disappearing or looping.
    time = 90;
    frame();
    expect(markerFor(chip).point).toEqual([...SUSPECTS[0].path.at(-1)!]);
  });

  it("publishes tracked units to the live layer and refreshes them on each poll", async () => {
    const { map, current, rerender } = await mount({ liveDevices: [device("Cruiser 7", 12)] });
    const source = map.sources.get("live-position");
    expect(source).toBeDefined();
    expect(source!.setData).toHaveBeenLastCalledWith(
      expect.objectContaining({
        features: expect.arrayContaining([
          expect.objectContaining({
            properties: expect.objectContaining({ name: "Cruiser 7", kind: "device" }),
          }),
        ]),
      }),
    );

    source!.setData.mockClear();
    rerender(<OperationsMap {...current} liveDevices={[device("Cruiser 7", 400)]} />);
    // A fresh array from the poll must reach the layer without a new map.
    expect(source!.setData).toHaveBeenCalled();
    expect(mocked.maps).toHaveLength(1);
  });

  it("flies to a tracked unit only when the request changes", async () => {
    const { map, current, rerender } = await mount();
    map.flyTo.mockClear();
    const fix = { longitude: -71.1, latitude: 42.37, nonce: 1 };
    rerender(<OperationsMap {...current} fixRequest={fix} />);
    expect(map.flyTo).toHaveBeenCalledWith(expect.objectContaining({ center: [-71.1, 42.37] }));

    map.flyTo.mockClear();
    rerender(<OperationsMap {...current} fixRequest={fix} />);
    expect(map.flyTo).not.toHaveBeenCalled();
  });
});
