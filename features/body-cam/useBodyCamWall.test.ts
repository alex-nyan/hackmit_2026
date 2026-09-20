import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FrameSummary } from "./frames";
import { useBodyCamWall } from "./useBodyCamWall";

const fetchMock = vi.fn();

function summary(sourceId: string, at = "2026-09-19T12:00:00.000Z"): FrameSummary {
  return { sourceId, at, bytes: 344 };
}

function respondWith(frames: FrameSummary[]) {
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ frames }) });
}

/** One poll plus the microtasks it settles through. */
async function tick(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock.mockReset();
  respondWith([]);
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("watching the wall", () => {
  it("asks the roster for the current answer, without caching it", async () => {
    renderHook(() => useBodyCamWall());
    await tick();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/streams",
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("lists every publishing officer once a poll lands", async () => {
    respondWith([summary("unit-01"), summary("unit-02")]);
    const { result } = renderHook(() => useBodyCamWall());
    expect(result.current.status).toBe("connecting");

    await tick();
    expect(result.current.frames.map((f) => f.sourceId)).toEqual(["unit-01", "unit-02"]);
    expect(result.current.status).toBe("live");
  });

  it("keeps polling, so an officer who joins later appears", async () => {
    const { result } = renderHook(() => useBodyCamWall());
    await tick();
    expect(result.current.frames).toEqual([]);

    respondWith([summary("unit-03")]);
    await tick(1_500);
    expect(result.current.frames.map((f) => f.sourceId)).toEqual(["unit-03"]);
  });

  it("drops an officer the roster no longer lists", async () => {
    respondWith([summary("unit-01")]);
    const { result } = renderHook(() => useBodyCamWall());
    await tick();
    expect(result.current.frames).toHaveLength(1);

    respondWith([]);
    await tick(1_500);
    expect(result.current.frames).toEqual([]);
  });

  it("holds the last roster when a poll fails, and says it cannot be trusted", async () => {
    respondWith([summary("unit-01")]);
    const { result } = renderHook(() => useBodyCamWall());
    await tick();

    fetchMock.mockRejectedValue(new Error("offline"));
    await tick(1_500);
    // An empty wall and an unreachable one must not look the same.
    expect(result.current.frames.map((f) => f.sourceId)).toEqual(["unit-01"]);
    expect(result.current.status).toBe("offline");
  });

  it("treats a failing response as offline, not as an empty wall", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    const { result } = renderHook(() => useBodyCamWall());
    await tick();
    expect(result.current.status).toBe("offline");
  });

  it("recovers once the roster answers again", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() => useBodyCamWall());
    await tick();
    expect(result.current.status).toBe("offline");

    respondWith([summary("unit-01")]);
    await tick(1_500);
    expect(result.current.status).toBe("live");
  });

  it("ignores a roster that is not a list", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ frames: "all of them" }) });
    const { result } = renderHook(() => useBodyCamWall());
    await tick();
    expect(result.current.frames).toEqual([]);
  });

  it("stops polling when the workspace unmounts", async () => {
    const { unmount } = renderHook(() => useBodyCamWall());
    await tick();
    const calls = fetchMock.mock.calls.length;
    unmount();
    await tick(5_000);
    expect(fetchMock.mock.calls.length).toBe(calls);
  });
});
