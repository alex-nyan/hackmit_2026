import { StrictMode } from "react";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BostonMap } from "./BostonMap";
import { MAP_FOCUS } from "./types";

const mocked = vi.hoisted(() => ({
  instances: [] as Array<{
    options: Record<string, unknown>;
    emit: (event: string, data?: unknown) => void;
    sourceLoaded: boolean;
    addLayer: ReturnType<typeof vi.fn>;
    addControl: ReturnType<typeof vi.fn>;
    flyTo: ReturnType<typeof vi.fn>;
    setStyle: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
  }>,
  supported: vi.fn(() => true),
  disconnect: vi.fn(),
}));

// Mock the loader, not concurrent dynamic imports inside Strict Mode effects.
vi.mock("./mapboxClient", () => ({
  loadMapbox: async () => ({
    supported: mocked.supported,
    NavigationControl: class {},
    FullscreenControl: class {},
    Map: class {
      options: Record<string, unknown>;
      handlers = new Map<string, Array<(data: unknown) => void>>();
      layer = false;
      sourceLoaded = false;
      addLayer = vi.fn(() => { this.layer = true; });
      addControl = vi.fn();
      flyTo = vi.fn();
      remove = vi.fn();
      resize = vi.fn();
      setStyle = vi.fn(() => { this.layer = false; this.sourceLoaded = false; });
      constructor(options: Record<string, unknown>) {
        this.options = options;
        mocked.instances.push(this);
      }
      getStyle() { return { layers: [] }; }
      getSource() { return {}; }
      getLayer() { return this.layer ? {} : undefined; }
      isSourceLoaded() { return this.sourceLoaded; }
      on(event: string, callback: (data: unknown) => void) {
        const handlers = this.handlers.get(event) ?? [];
        this.handlers.set(event, [...handlers, callback]);
      }
      emit(event: string, data: unknown = {}) {
        for (const callback of this.handlers.get(event) ?? []) callback(data);
      }
    },
  }),
}));

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN", "pk.unit-test-not-a-real-token");
  mocked.instances.length = 0;
  mocked.supported.mockReturnValue(true);
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    disconnect = mocked.disconnect;
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function mount() {
  const status = vi.fn();
  const view = render(<BostonMap focus="mit" theme="light" onStatusChange={status} />);
  await waitFor(() => expect(mocked.instances).toHaveLength(1));
  return { ...view, status, map: mocked.instances[0] };
}

describe("Mapbox lifecycle", () => {
  it("shows setup feedback without requesting Mapbox when the token is absent", () => {
    vi.stubEnv("NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN", "");
    const status = vi.fn();
    render(<BostonMap focus="mit" theme="light" onStatusChange={status} />);
    expect(status).toHaveBeenLastCalledWith("missing-token");
    expect(mocked.instances).toHaveLength(0);
  });

  it("rejects a secret token rather than using it for map requests", () => {
    vi.stubEnv("NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN", "sk.not-a-real-token");
    const status = vi.fn();
    render(<BostonMap focus="mit" theme="light" onStatusChange={status} />);
    expect(status).toHaveBeenLastCalledWith("error");
    expect(mocked.instances).toHaveLength(0);
  });

  it("reports unavailable WebGL without creating a map", async () => {
    mocked.supported.mockReturnValue(false);
    const status = vi.fn();
    render(<BostonMap focus="mit" theme="light" onStatusChange={status} />);
    await waitFor(() => expect(status).toHaveBeenLastCalledWith("error"));
    expect(mocked.instances).toHaveLength(0);
  });

  it("preserves the MIT camera and only reports ready when tiles are loaded", async () => {
    const { map, status } = await mount();
    expect(map.options).toMatchObject({
      center: MAP_FOCUS.mit.center, zoom: 16.1, pitch: 45, bearing: -17.6,
      antialias: true, style: "mapbox://styles/mapbox/light-v11",
    });
    expect(map.addControl).toHaveBeenCalledTimes(2);
    act(() => map.emit("style.load"));
    expect(status).toHaveBeenLastCalledWith("loading");
    map.sourceLoaded = true;
    act(() => map.emit("sourcedata", { sourceId: "composite", isSourceLoaded: true }));
    expect(status).toHaveBeenLastCalledWith("ready");
  });

  it("moves the existing map and restores buildings after a theme change", async () => {
    const { map, status, rerender } = await mount();
    act(() => map.emit("style.load"));
    rerender(<BostonMap focus="harvard" theme="dark" onStatusChange={status} />);
    expect(mocked.instances).toHaveLength(1);
    expect(map.flyTo).toHaveBeenLastCalledWith(expect.objectContaining({ center: MAP_FOCUS.harvard.center }));
    expect(map.setStyle).toHaveBeenLastCalledWith("mapbox://styles/mapbox/dark-v11");
    act(() => map.emit("style.load"));
    expect(map.addLayer).toHaveBeenCalledTimes(2);
    expect(map.addLayer.mock.calls[1][0]).toMatchObject({ paint: { "fill-extrusion-color": "#81939b" } });
  });

  it("reports authentication errors but allows transient errors to recover", async () => {
    const { map, status } = await mount();
    act(() => map.emit("error", { error: { status: 503 } }));
    expect(status).toHaveBeenLastCalledWith("loading");
    act(() => map.emit("error", { error: { status: 401 } }));
    expect(status).toHaveBeenLastCalledWith("error");
  });

  it("cleans up the map and resize observer on unmount", async () => {
    const { map, unmount } = await mount();
    unmount();
    expect(map.remove).toHaveBeenCalledOnce();
    expect(mocked.disconnect).toHaveBeenCalledOnce();
  });

  it("does not create a leaked duplicate map under Strict Mode", async () => {
    const status = vi.fn();
    const view = render(<StrictMode><BostonMap focus="mit" theme="light" onStatusChange={status} /></StrictMode>);
    await waitFor(() => expect(mocked.instances).toHaveLength(1));
    view.unmount();
    expect(mocked.instances[0].remove).toHaveBeenCalledOnce();
  });

  it("uses the latest area and theme when controls change before lazy loading finishes", async () => {
    const status = vi.fn();
    const view = render(<BostonMap focus="mit" theme="light" onStatusChange={status} />);
    view.rerender(<BostonMap focus="boston" theme="dark" onStatusChange={status} />);
    await waitFor(() => expect(mocked.instances).toHaveLength(1));
    expect(mocked.instances[0].options).toMatchObject({
      center: MAP_FOCUS.boston.center,
      style: "mapbox://styles/mapbox/dark-v11",
    });
  });

  it("does not create a map after unmounting during lazy loading", async () => {
    const status = vi.fn();
    const view = render(<BostonMap focus="mit" theme="light" onStatusChange={status} />);
    view.unmount();
    await act(async () => { await Promise.resolve(); });
    expect(mocked.instances).toHaveLength(0);
  });

  it("bounds the loading state and can recover when tiles arrive later", async () => {
    vi.useFakeTimers();
    const status = vi.fn();
    await act(async () => {
      render(<BostonMap focus="mit" theme="light" onStatusChange={status} />);
    });
    const map = mocked.instances[0];
    act(() => map.emit("style.load"));
    act(() => vi.advanceTimersByTime(20000));
    expect(status).toHaveBeenLastCalledWith("error");
    map.sourceLoaded = true;
    act(() => map.emit("idle"));
    expect(status).toHaveBeenLastCalledWith("ready");
  });
});
