import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyCommand, createInstance, publicInstance } from "./model";
const fake = vi.hoisted(() => ({
  state: {
    snapshot: null as import("./types").InstanceSnapshot | null,
    error: null as string | null,
  },
  api: vi.fn(async () => ({})),
  map: vi.fn(),
  media: vi.fn(),
}));
vi.mock("./client", () => ({ useInstance: () => fake.state, api: fake.api }));
vi.mock("./useRemoteMedia", () => ({
  useRemoteMedia: (...args: unknown[]) => {
    fake.media(...args);
    return { media: null, error: null };
  },
}));
vi.mock("../paw-patrol/OperationsMap", () => ({
  OperationsMap: (props: unknown) => {
    fake.map(props);
    return <div>Map</div>;
  },
}));
import { SharedWorkspace } from "./SharedWorkspace";
const now = Date.now();
const active = () =>
  publicInstance(
    applyCommand(
      createInstance("shared-id", "Officer Alex", "secret", now),
      { type: "start" },
      now,
      1,
    ),
    now,
  );
beforeEach(() => {
  HTMLDialogElement.prototype.close = vi.fn();
  HTMLDialogElement.prototype.showModal = vi.fn();
  fake.state = { snapshot: { instance: active(), serverTime: now }, error: null };
});
afterEach(cleanup);

describe("shared workspace views", () => {
  it("shows Hospital's minimal unassigned state without device controls", () => {
    fake.state.snapshot!.instance = null;
    render(<SharedWorkspace role="hospital" />);
    expect(screen.getByText("No officer requested")).toBeTruthy();
    expect(screen.queryByText(/Connect.*watch/)).toBeNull();
  });
  it("shows the same name and ID directly on footage with no synthetic chart", () => {
    render(<SharedWorkspace role="hospital" />);
    expect(screen.getByText("Officer Alex")).toBeTruthy();
    expect(screen.getByText("shared-id")).toBeTruthy();
    expect(screen.getByRole("img", { name: "Received heart rate trend" })).toBeTruthy();
    expect(screen.getByText("Waiting for readings")).toBeTruthy();
    expect(screen.queryByText("Preview")).toBeNull();
    expect(screen.getByLabelText("Officer camera and audio").getAttribute("data-cleared")).toBe(
      "false",
    );
  });
  it("only shows green after an explicit scene clearance and current broadcast", () => {
    fake.state.snapshot!.instance!.scene.status = "cleared";
    const { rerender } = render(<SharedWorkspace role="hospital" />);
    expect(screen.getByLabelText("Officer camera and audio").getAttribute("data-cleared")).toBe(
      "true",
    );
    fake.state.snapshot!.instance!.lifecycle = "offline";
    rerender(<SharedWorkspace role="hospital" />);
    expect(screen.getByLabelText("Officer camera and audio").getAttribute("data-cleared")).toBe(
      "false",
    );
    expect(fake.media).toHaveBeenLastCalledWith(null, "publisher-shared-id", true);
  });
  it("shows the real instance separately from the demo and never invents a GPS position", () => {
    render(<SharedWorkspace role="officer" />);
    expect(screen.getByText("Officer Alex")).toBeTruthy();
    expect(screen.getByLabelText("Patrol demo")).toBeTruthy();
    expect(fake.map.mock.lastCall?.[0].liveDevices).toEqual([]);
    expect(screen.getByText("GPS unavailable")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Connect/i })).toBeNull();
  });
  it("Dispatch requests/cancels Hospital without issuing a scene clearance", () => {
    const { rerender } = render(<SharedWorkspace role="dispatch" />);
    fireEvent.click(screen.getByRole("button", { name: "Request medical assistance" }));
    expect(fake.api).toHaveBeenCalledWith("/command", {
      id: "shared-id",
      type: "assignment",
      requested: true,
    });
    fake.state.snapshot!.instance!.hospitalRequested = true;
    rerender(<SharedWorkspace role="dispatch" />);
    expect(screen.getByRole("button", { name: "Clear hospital request" })).toBeTruthy();
    expect(fake.api).not.toHaveBeenCalledWith(
      "/command",
      expect.objectContaining({ type: "scene" }),
    );
  });
});
