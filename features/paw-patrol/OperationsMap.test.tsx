import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OperationsMap, type OperationsMapProps } from "./OperationsMap";
import { BUILDING_LAYER_ID } from "../boston-map/buildingLayer";
import { MAP_FOCUS } from "../boston-map/types";
import { initialDemo } from "./useScenario";
import { PEOPLE } from "./scenario";
import { vehicleAt } from "./vehicles/vehicleMotion";
import * as vehicleMotion from "./vehicles/vehicleMotion";
import { patrolCarScreenHeading } from "./vehicles/createPatrolCarMarker";
import type { LiveDevice } from "@/features/live-track";

type Handler = (data: Record<string, unknown>) => void;
type TestLayer = { id: string; onRemove?: () => void; [key: string]: unknown };
const mocked = vi.hoisted(() => ({
  maps: [] as TestMap[],
  markers: [] as TestMarker[],
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
  bearing = -17.6;
  pitch = 45;
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
    return this.bearing;
  }
  getPitch() {
    return this.pitch;
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
    const radians = (this.bearing * Math.PI) / 180;
    const east = (point[0] - this.center.lng) * Math.cos((42.36 * Math.PI) / 180) * 10_000;
    const north = (point[1] - this.center.lat) * 10_000;
    return {
      x: east * Math.cos(radians) - north * Math.sin(radians),
      y:
        -(east * Math.sin(radians) + north * Math.cos(radians)) *
        Math.cos((this.pitch * Math.PI) / 180),
    };
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
  constructor(
    public options: {
      element: HTMLElement;
      anchor?: string;
      rotationAlignment?: string;
      pitchAlignment?: string;
    },
  ) {
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

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN", "pk.unit-test-not-a-real-token");
  mocked.maps.length = 0;
  mocked.markers.length = 0;
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
  await waitFor(() => expect(mocked.markers).toHaveLength(PEOPLE.length * 3));
  await waitFor(() => expect(mocked.maps[0].getLayer(BUILDING_LAYER_ID)).toBeDefined());
  await waitFor(() => expect(view.queryByRole("status")).toBeNull());
  expectNoPatrolRoutes(mocked.maps[0]);
  return { ...view, current, map: mocked.maps[0] };
}

function expectNoPatrolRoutes(map: TestMap) {
  for (const id of ["paw-scenario-route", "paw-route-arrows"]) {
    expect(map.getSource(id)).toBeUndefined();
    expect(map.addSource.mock.calls.some(([sourceId]) => sourceId === id)).toBe(false);
  }
  for (const id of [
    "paw-scenario-route-casing",
    "paw-scenario-route-line",
    "paw-route-arrow-line",
  ]) {
    expect(map.getLayer(id)).toBeUndefined();
    expect(map.addLayer.mock.calls.some(([layer]) => layer.id === id)).toBe(false);
  }
}

function carMarkers() {
  return mocked.markers.filter(
    (marker) =>
      marker.options.element.getAttribute("aria-hidden") === "true" &&
      // The ground beacon is aria-hidden too; only the car is wanted here.
      !marker.options.element.dataset.kind,
  );
}

function expectFixedCar(marker: TestMarker) {
  const element = marker.options.element;
  const car = element.querySelector("svg");
  expect(car).not.toBeNull();
  expect(car?.getAttribute("width")).toBe("32");
  expect(car?.getAttribute("height")).toBe("44");
  expect(element.hidden).toBe(false);
  expect(element.hasAttribute("data-detail")).toBe(false);
  expect(marker.options).toEqual(
    expect.objectContaining({
      anchor: "center",
      pitchAlignment: "viewport",
      rotationAlignment: "viewport",
    }),
  );
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
    expect(carMarkers()[1].options.element.dataset.selected).toBe("true");
    expect(carMarkers()[0].options.element.dataset.selected).toBe("false");
    expectNoPatrolRoutes(map);
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

  it("shares the continuous clock between label positions, car positions and headings", async () => {
    let time = 0;
    const readClock = vi.fn(() => ({ ...initialDemo, running: true, time }));
    const { map } = await mount({ running: true, readClock });
    time = 2.5;
    frame();
    expectNoPatrolRoutes(map);
    for (const person of PEOPLE) {
      const vehicle = vehicleAt(person.id, time);
      const marker = mocked.markers.find((value) =>
        value.options.element.textContent?.includes(person.id),
      );
      expect(marker?.point).toEqual(vehicle.point);
      expect(marker?.setOffset).toHaveBeenLastCalledWith([0, -26]);
      const car = carMarkers()[PEOPLE.indexOf(person)];
      expect(car.point).toEqual(vehicle.point);
      expect(car.setRotation).toHaveBeenLastCalledWith(
        patrolCarScreenHeading(map, vehicle.point, vehicle.heading),
      );
    }
  });

  it("updates paused car headings after camera movement without recursively moving a followed camera", async () => {
    const { map } = await mount({ following: true });
    const car = carMarkers()[0];
    const initialHeading = car.setRotation.mock.calls.at(-1);
    map.jumpTo.mockClear();
    map.flyTo.mockClear();
    map.bearing = 72.4;
    map.pitch = 65;
    map.zoom = 13;
    act(() => map.emit("move"));
    const pose = vehicleAt("P-01", 0);
    expect(car.setRotation.mock.calls.at(-1)).not.toEqual(initialHeading);
    expect(car.setRotation).toHaveBeenLastCalledWith(
      patrolCarScreenHeading(map, pose.point, pose.heading),
    );
    expect(car.point).toEqual(pose.point);
    expectFixedCar(car);
    expectNoPatrolRoutes(map);
    expect(map.jumpTo).not.toHaveBeenCalled();
    expect(map.flyTo).not.toHaveBeenCalled();
    expect(mocked.frames.size).toBe(0);
  });

  it("preserves DOM cars and restores buildings and live tracking without route overlays on theme changes", async () => {
    const { map, current, rerender } = await mount();
    const cars = carMarkers();
    rerender(<OperationsMap {...current} theme="dark" />);
    expect(map.setStyle).toHaveBeenLastCalledWith("mapbox://styles/mapbox/dark-v11");
    act(() => map.emit("style.load"));
    expect(mocked.maps).toHaveLength(1);
    expect(map.layers.has("paw-patrol-vehicles")).toBe(false);
    expect(map.addLayer.mock.calls.some(([layer]) => layer.type === "custom")).toBe(false);
    expect(map.getLayer(BUILDING_LAYER_ID)).toBeDefined();
    expect(map.getSource("live-position")).toBeDefined();
    expectNoPatrolRoutes(map);
    expect(carMarkers()).toEqual(cars);
    for (const car of cars) {
      expectFixedCar(car);
      expect(car.options.element.isConnected).toBe(true);
      expect(car.remove).not.toHaveBeenCalled();
    }
    const count = map.addLayer.mock.calls.length;
    act(() => map.emit("style.load"));
    expect(map.addLayer).toHaveBeenCalledTimes(count);
    expect(mocked.markers).toHaveLength(PEOPLE.length * 3);
    expectNoPatrolRoutes(map);
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
    for (const marker of mocked.markers) {
      expect(marker.remove).toHaveBeenCalledOnce();
      expect(marker.options.element.isConnected).toBe(false);
    }
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
    act(() => map.emit("move"));
    const marker = getByRole("button", { name: new RegExp(`${PEOPLE[1].name}.*P-02`) });
    expect(marker.tagName).toBe("BUTTON");
    expect(marker.getAttribute("aria-pressed")).toBe("false");
    marker.focus();
    expect(document.activeElement).toBe(marker);
    // Native buttons provide Enter/Space activation; click exercises that same handler.
    fireEvent.click(marker);
    expect(onSelect).toHaveBeenLastCalledWith("P-02");
  });

  it("selects the unit represented by a projected car marker hit", async () => {
    const onSelect = vi.fn();
    const { map } = await mount({ onSelect });
    const point = map.project(vehicleAt("P-04", 0).point);
    act(() => map.emit("click", { point }));
    expect(onSelect).toHaveBeenLastCalledWith("P-04");
    onSelect.mockClear();
    act(() => map.emit("click", { point: { x: 5000, y: 5000 } }));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it.each([10.5, 13, 16, 19.5])(
    "keeps every patrol car at the same screen size at zoom %s",
    async (zoom) => {
      const { map, getByRole } = await mount();
      map.zoom = zoom;
      act(() => map.emit("move"));
      expect(carMarkers()).toHaveLength(PEOPLE.length);
      for (const car of carMarkers()) expectFixedCar(car);
      for (const person of PEOPLE) {
        const button = getByRole("button", { name: new RegExp(`${person.name}.*${person.id}`) });
        expect(button.hasAttribute("data-detail")).toBe(false);
        const label = mocked.markers.find((marker) => marker.options.element.contains(button));
        expect(label?.setOffset).toHaveBeenLastCalledWith([0, -26]);
      }
      expect(map.layers.has("paw-patrol-vehicles")).toBe(false);
      expect(map.addLayer.mock.calls.some(([layer]) => layer.type === "custom")).toBe(false);
      expectNoPatrolRoutes(map);
    },
  );

  it("changes selection and emergency styling without changing the car size", async () => {
    const { current, rerender } = await mount();
    const cars = carMarkers();
    expect(cars[0].options.element.dataset.selected).toBe("true");
    expect(cars[1].options.element.dataset.selected).toBe("false");
    expect(cars[1].options.element.dataset.emergency).toBe("false");
    const originalVehicleAt = vehicleMotion.vehicleAt;
    const sample = vi.spyOn(vehicleMotion, "vehicleAt").mockImplementation((id, time) => ({
      ...originalVehicleAt(id, time),
      emergency: id === "P-02",
    }));
    try {
      rerender(<OperationsMap {...current} selectedId="P-02" />);
      expect(cars[0].options.element.dataset.selected).toBe("false");
      expect(cars[1].options.element.dataset.selected).toBe("true");
      expect(cars[1].options.element.dataset.emergency).toBe("true");
      expect(carMarkers()).toEqual(cars);
      for (const car of cars) expectFixedCar(car);
    } finally {
      sample.mockRestore();
    }
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

  it("beams a green beacon from under every officer", async () => {
    let time = 0;
    const readClock = () => ({ ...initialDemo, time, running: true });
    const { container } = await mount({ running: true, readClock });
    const beacons = (kind: string) => [
      ...container.querySelectorAll<HTMLElement>(`[data-kind="${kind}"]`),
    ];
    expect(beacons("officer")).toHaveLength(PEOPLE.length);

    time = 30;
    frame();
    PEOPLE.forEach((person, index) => {
      const green = beacons("officer")[index];
      expect(green.hidden).toBe(false);
      expect(markerFor(green).point).toEqual(vehicleAt(person.id, time).point);
    });
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
