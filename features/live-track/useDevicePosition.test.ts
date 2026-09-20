import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useDevicePosition } from "./useDevicePosition";

const NOW = Date.parse("2026-09-20T12:00:00.000Z");

const fetchMock = vi.fn();
const watchPosition = vi.fn();
const clearWatch = vi.fn();

type Callbacks = {
  onFix: PositionCallback;
  onError: PositionErrorCallback;
};

/** The callbacks the hook handed to the most recent `watchPosition`. */
function watcher(): Callbacks {
  const call = watchPosition.mock.calls.at(-1);
  if (!call) throw new Error("the hook never started a watch");
  return { onFix: call[0], onError: call[1] };
}

function fix(overrides: Partial<GeolocationCoordinates> = {}, timestamp = NOW) {
  return {
    timestamp,
    coords: {
      longitude: -71.092,
      latitude: 42.36,
      accuracy: 12,
      speed: 5,
      heading: 90,
      altitude: null,
      altitudeAccuracy: null,
      ...overrides,
    },
  } as GeolocationPosition;
}

function refusal(code: number) {
  return {
    code,
    PERMISSION_DENIED: 1,
    POSITION_UNAVAILABLE: 2,
    TIMEOUT: 3,
    message: "",
  } as GeolocationPositionError;
}

async function tick(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function published(call = 0) {
  return JSON.parse(fetchMock.mock.calls[call][1].body as string) as Record<string, unknown>;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  fetchMock.mockReset().mockResolvedValue({ ok: true });
  watchPosition.mockReset().mockReturnValue(7);
  clearWatch.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("navigator", { geolocation: { watchPosition, clearWatch } });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("sharing a position", () => {
  it("asks for nothing until a person presses the button", () => {
    const { result } = renderHook(() => useDevicePosition("Unit 01"));
    expect(result.current.state).toEqual({ state: "idle" });
    expect(watchPosition).not.toHaveBeenCalled();
  });

  it("reports that it is waiting on permission once started", () => {
    const { result } = renderHook(() => useDevicePosition("Unit 01"));
    act(() => result.current.start());
    expect(result.current.state).toEqual({ state: "requesting" });
    expect(watchPosition).toHaveBeenCalledOnce();
  });

  it("asks for the best fix the device can give and never a cached one", () => {
    const { result } = renderHook(() => useDevicePosition("Unit 01"));
    act(() => result.current.start());
    expect(watchPosition.mock.calls[0][2]).toMatchObject({
      enableHighAccuracy: true,
      maximumAge: 0,
    });
  });

  it("publishes the fix under the unit's sanitised id, with its typed name", async () => {
    const { result } = renderHook(() => useDevicePosition("Unit 01"));
    act(() => result.current.start());
    act(() => watcher().onFix(fix()));
    await tick(4_000);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/positions",
      expect.objectContaining({
        method: "POST",
        cache: "no-store",
      }),
    );
    expect(published()).toMatchObject({
      sourceId: "Unit-01",
      name: "Unit 01",
      longitude: -71.092,
      latitude: 42.36,
      accuracyMeters: 12,
      headingDegrees: 90,
      fixedAt: "2026-09-20T12:00:00.000Z",
    });
  });

  it("converts the browser's metres per second into the km/h everything else uses", async () => {
    const { result } = renderHook(() => useDevicePosition("Unit 01"));
    act(() => result.current.start());
    act(() => watcher().onFix(fix({ speed: 5 })));
    await tick(4_000);
    expect(published().speedKmh).toBeCloseTo(18);
  });

  it("sends null rather than a made-up zero when the device omits a reading", async () => {
    const { result } = renderHook(() => useDevicePosition("Unit 01"));
    act(() => result.current.start());
    act(() => watcher().onFix(fix({ speed: null, heading: null, accuracy: Number.NaN })));
    await tick(4_000);
    expect(published()).toMatchObject({
      speedKmh: null,
      headingDegrees: null,
      accuracyMeters: null,
    });
  });

  it("keeps republishing a held fix, so a stationary unit does not go amber", async () => {
    const { result } = renderHook(() => useDevicePosition("Unit 01"));
    act(() => result.current.start());
    act(() => watcher().onFix(fix()));

    await tick(4_000);
    await tick(4_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("stops republishing once the held fix is too old to say where the phone is", async () => {
    const { result } = renderHook(() => useDevicePosition("Unit 01"));
    act(() => result.current.start());
    act(() => watcher().onFix(fix()));

    // The GPS has gone quiet. Republishing carries the fix while it is still
    // current and then stops, so the unit ages out instead of staying green on
    // a corner it left minutes ago.
    await tick(120_000);
    const whileCurrent = fetchMock.mock.calls.length;
    expect(whileCurrent).toBeGreaterThan(1);

    await tick(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(whileCurrent);
  });

  it("surfaces a failed publish instead of looking like it is still reporting", async () => {
    const { result } = renderHook(() => useDevicePosition("Unit 01"));
    act(() => result.current.start());
    act(() => watcher().onFix(fix()));
    fetchMock.mockRejectedValue(new Error("offline"));
    await tick(4_000);

    expect(result.current.state).toMatchObject({
      state: "publishing",
      lastError: "The last position could not be published.",
    });
  });

  it("says plainly when a deployment has nowhere to store a position", async () => {
    const { result } = renderHook(() => useDevicePosition("Unit 01"));
    act(() => result.current.start());
    act(() => watcher().onFix(fix()));
    fetchMock.mockResolvedValue({ ok: false, status: 503 });
    await tick(4_000);

    expect(result.current.state).toMatchObject({
      lastError: "This deployment has nowhere to store positions.",
    });
  });
});

describe("refusal and teardown", () => {
  it("drops the watch when permission is refused rather than retrying forever", () => {
    const { result } = renderHook(() => useDevicePosition("Unit 01"));
    act(() => result.current.start());
    act(() => watcher().onError(refusal(1)));

    expect(result.current.state.state).toBe("denied");
    expect(clearWatch).toHaveBeenCalledWith(7);
  });

  it("keeps watching through a transient failure, because the browser retries", () => {
    const { result } = renderHook(() => useDevicePosition("Unit 01"));
    act(() => result.current.start());
    act(() => watcher().onError(refusal(2)));

    expect(result.current.state.state).toBe("publishing");
    expect(clearWatch).not.toHaveBeenCalled();
  });

  it("releases the watch and publishes nothing further once stopped", async () => {
    const { result } = renderHook(() => useDevicePosition("Unit 01"));
    act(() => result.current.start());
    act(() => watcher().onFix(fix()));
    act(() => result.current.stop());

    expect(clearWatch).toHaveBeenCalledWith(7);
    expect(result.current.state).toEqual({ state: "idle" });
    await tick(20_000);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("leaves no watch running behind an unmounted page", () => {
    const { result, unmount } = renderHook(() => useDevicePosition("Unit 01"));
    act(() => result.current.start());
    unmount();
    expect(clearWatch).toHaveBeenCalledWith(7);
  });

  it("reports a browser that cannot do this at all", () => {
    vi.stubGlobal("navigator", {});
    const { result } = renderHook(() => useDevicePosition("Unit 01"));
    act(() => result.current.start());
    expect(result.current.state.state).toBe("unsupported");
  });
});

describe("renaming a unit", () => {
  it("publishes under the new name without re-prompting for permission", async () => {
    const { result, rerender } = renderHook(({ name }) => useDevicePosition(name), {
      initialProps: { name: "Unit 01" },
    });
    act(() => result.current.start());
    act(() => watcher().onFix(fix()));

    rerender({ name: "Unit 09" });
    await tick(4_000);

    expect(watchPosition).toHaveBeenCalledOnce();
    expect(published()).toMatchObject({ sourceId: "Unit-09", name: "Unit 09" });
  });
});

describe("what a dashboard calls the unit", () => {
  it("publishes the officer's name while keeping their id as the source", async () => {
    const { result } = renderHook(() => useDevicePosition("unit-01", "A. Nyan"));
    act(() => result.current.start());
    act(() => watcher().onFix(fix()));
    await tick(4_000);

    // The map names the person; the pipeline still keys on the officer id.
    expect(published()).toMatchObject({ sourceId: "unit-01", name: "A. Nyan" });
  });

  it("falls back to the typed unit name, which is how it worked before sign-in", async () => {
    const { result } = renderHook(() => useDevicePosition("Unit 02"));
    act(() => result.current.start());
    act(() => watcher().onFix(fix()));
    await tick(4_000);

    expect(published()).toMatchObject({ sourceId: "Unit-02", name: "Unit 02" });
  });
});
