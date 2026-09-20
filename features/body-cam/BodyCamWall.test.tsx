import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BodyCamWall, describeAge, freshness } from "./BodyCamWall";
import type { FrameSummary } from "./frames";

const NOW = Date.parse("2026-09-19T12:00:10.000Z");
const fetchMock = vi.fn();

function summary(sourceId: string, at: string): FrameSummary {
  return { sourceId, at, bytes: 344 };
}

function respondWith(frames: FrameSummary[]) {
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ frames }) });
}

async function tick(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  fetchMock.mockReset();
  respondWith([]);
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the body camera wall", () => {
  it("explains how to get a camera onto it when nobody is publishing", async () => {
    render(<BodyCamWall />);
    await tick();
    expect(screen.getByText(/No officer is publishing/)).toBeDefined();
    expect(screen.getByText(/0 publishing/)).toBeDefined();
  });

  it("renders a tile per officer, fetching the image rather than inlining it", async () => {
    respondWith([summary("unit-02", "2026-09-19T12:00:09.000Z")]);
    render(<BodyCamWall />);
    await tick();

    const shot = screen.getByAltText("Latest frame published by unit-02");
    // The timestamp makes each frame its own URL, so the browser refetches
    // exactly when there is something new.
    expect(shot.getAttribute("src")).toBe(
      "/api/streams/unit-02/frame?at=2026-09-19T12%3A00%3A09.000Z",
    );
    expect(screen.getByText("unit-02")).toBeDefined();
    expect(screen.getByText(/1 publishing/)).toBeDefined();
  });

  it("escapes a source id rather than pasting it into a URL", async () => {
    respondWith([summary("unit:02", "2026-09-19T12:00:09.000Z")]);
    render(<BodyCamWall />);
    await tick();
    expect(screen.getByAltText("Latest frame published by unit:02").getAttribute("src")).toContain(
      "/api/streams/unit%3A02/frame",
    );
  });

  it("ages a tile in place, so a frozen feed cannot pass for a current one", async () => {
    respondWith([summary("unit-01", "2026-09-19T12:00:07.000Z")]);
    render(<BodyCamWall />);
    await tick();
    expect(screen.getByText("3s ago").getAttribute("data-freshness")).toBe("fresh");

    await tick(12_000);
    expect(screen.getByText("15s ago").getAttribute("data-freshness")).toBe("stale");
  });

  it("says plainly that these are stills", async () => {
    render(<BodyCamWall />);
    await tick();
    expect(screen.getByText(/not a live video feed/)).toBeDefined();
  });

  it("reports a roster it has lost rather than showing a quiet wall", async () => {
    render(<BodyCamWall />);
    await tick();
    expect(screen.getByText("LIVE")).toBeDefined();

    fetchMock.mockRejectedValue(new Error("offline"));
    await tick(1_500);
    expect(screen.getByText("NOT SYNCED")).toBeDefined();
  });
});

describe("freshness labelling", () => {
  it("grades a frame by how long ago it arrived", () => {
    expect(freshness(0)).toBe("fresh");
    expect(freshness(4_000)).toBe("fresh");
    expect(freshness(4_001)).toBe("aging");
    expect(freshness(10_001)).toBe("stale");
  });

  it("reads an age the way a person would say it", () => {
    expect(describeAge(0)).toBe("just now");
    expect(describeAge(1_400)).toBe("just now");
    expect(describeAge(9_000)).toBe("9s ago");
    expect(describeAge(Number.POSITIVE_INFINITY)).toBe("age unknown");
  });
});
