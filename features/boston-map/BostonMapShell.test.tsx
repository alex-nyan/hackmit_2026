import { useEffect } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BostonMapShell } from "./BostonMapShell";
import type { MapStatus } from "./types";

const mocks = vi.hoisted(() => ({
  onStatusChange: null as null | ((status: MapStatus) => void),
  captureMounted: vi.fn(),
  captureStopped: vi.fn(),
}));

vi.mock("./BostonMap", () => ({
  BostonMap: ({ onStatusChange }: { onStatusChange: (status: MapStatus) => void }) => {
    mocks.onStatusChange = onStatusChange;
    return <div>Map</div>;
  },
}));

vi.mock("@/features/camera-triage", () => ({
  CapturePanel: function CapturePanel() {
    useEffect(() => {
      mocks.captureMounted();
      return () => mocks.captureStopped();
    }, []);
    return <aside aria-label="Camera">Capture controls</aside>;
  },
}));

vi.mock("@/features/live-track", () => ({
  useLiveTrack: () => ({ state: "idle" }),
  LiveTrackPanel: () => null,
}));

beforeEach(() => {
  mocks.onStatusChange = null;
});

afterEach(cleanup);

describe("dashboard capture lifetime", () => {
  it("keeps capture opt-in and available without a working map", () => {
    render(<BostonMapShell />);
    act(() => mocks.onStatusChange?.("missing-token"));
    expect(screen.queryByRole("complementary", { name: "Camera" })).toBeNull();
    expect(mocks.captureMounted).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Show the camera panel" }));
    expect(screen.getByRole("complementary", { name: "Camera" })).toBeTruthy();
    expect(mocks.captureMounted).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "Hide the camera panel" }));
    expect(mocks.captureStopped).toHaveBeenCalledOnce();
  });

  it("does not stop capture while a theme change reloads the map or a map error occurs", () => {
    render(<BostonMapShell />);
    act(() => mocks.onStatusChange?.("ready"));
    fireEvent.click(screen.getByRole("button", { name: "Show the camera panel" }));
    const panel = screen.getByRole("complementary", { name: "Camera" });

    fireEvent.click(screen.getByRole("button", { name: "Switch to dark map" }));
    for (const status of ["loading", "ready", "error"] as const) {
      act(() => mocks.onStatusChange?.(status));
      expect(screen.getByRole("complementary", { name: "Camera" })).toBe(panel);
    }
    expect(mocks.captureMounted).toHaveBeenCalledOnce();
    expect(mocks.captureStopped).not.toHaveBeenCalled();
  });
});
