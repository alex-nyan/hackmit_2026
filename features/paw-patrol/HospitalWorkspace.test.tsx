import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { hospitalAccess } from "./HospitalWorkspace";
import { OfficerFeed } from "./OfficerFeed";
import type { IncidentEvent } from "./incidents";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const scene = (overrides: Partial<IncidentEvent> = {}): IncidentEvent => ({
  seq: 1,
  id: "clear",
  kind: "scene",
  origin: "operator",
  at: "2026-09-20T12:00:00Z",
  scenarioAt: 0,
  personId: null,
  title: "Scene reported cleared",
  detail: "Manual report",
  source: "Command desk",
  provenance: null,
  requiresHumanReview: true,
  ...overrides,
});

describe("hospital access indicator", () => {
  it("uses explicit operator clearance, never an empty log or model output", () => {
    expect(hospitalAccess([], "P-01", "live").cleared).toBe(false);
    expect(hospitalAccess([scene({ origin: "model" })], "P-01", "live").cleared).toBe(false);
    expect(hospitalAccess([scene({ kind: "hazard" })], "P-01", "live").cleared).toBe(false);
    expect(hospitalAccess([scene()], "P-01", "live").cleared).toBe(true);
  });
  it("withdraws green when reports change, the selected person changes or updates disconnect", () => {
    expect(
      hospitalAccess([scene(), scene({ seq: 2, title: "Scene reported unsafe" })], "P-01", "live")
        .label,
    ).toBe("Hold · Scene unsafe");
    expect(
      hospitalAccess([scene(), scene({ seq: 2, title: "Scene reported unknown" })], "P-01", "live")
        .cleared,
    ).toBe(false);
    expect(hospitalAccess([scene({ personId: "P-02" })], "P-01", "live").cleared).toBe(false);
    for (const status of ["offline", "connecting"] as const)
      expect(hospitalAccess([scene()], "P-01", status).cleared).toBe(false);
  });
});

class Track extends EventTarget {
  readyState = "live";
  muted = false;
  enabled = true;
  stop = vi.fn();
  constructor(readonly kind: "audio" | "video") {
    super();
  }
}
class Stream extends EventTarget {
  constructor(
    readonly id: string,
    public tracks: Track[],
  ) {
    super();
  }
  getTracks() {
    return this.tracks;
  }
}
const input = (stream: Stream, personId = "P-01") => ({
  personId,
  stream: stream as unknown as MediaStream,
});

describe("officer media connection point", () => {
  it("keeps absent media empty and never requests this browser's camera", () => {
    const ui = render(<OfficerFeed personId="P-01" />);
    expect(ui.getByText("Waiting for officer camera")).toBeTruthy();
    expect(ui.queryByRole("button", { name: /audio/i })).toBeNull();
    expect(ui.queryByRole("button", { name: "Play feed" })).toBeNull();
    expect((ui.getByLabelText("Officer camera feed") as HTMLVideoElement).srcObject).toBeNull();
  });
  it("attaches the matching stream with sound, supports playback, and clears ended video", async () => {
    const camera = new Track("video"),
      microphone = new Track("audio");
    const stream = new Stream("first", [camera, microphone]);
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    const ui = render(<OfficerFeed personId="P-01" input={input(stream)} />);
    const element = ui.getByLabelText("Officer camera feed") as HTMLVideoElement;
    expect(element.srcObject).toBe(stream);
    expect(element.muted).toBe(false);
    expect(ui.queryByText("Live")).toBeNull();
    fireEvent.click(ui.getByRole("button", { name: "Play feed" }));
    await waitFor(() => expect(play).toHaveBeenCalled());
    fireEvent.playing(element);
    expect(ui.getByText("Live")).toBeTruthy();
    expect(ui.queryByRole("button", { name: /audio/i })).toBeNull();
    expect(play).toHaveBeenCalledTimes(1);
    expect(element.muted).toBe(false);
    act(() => {
      camera.readyState = "ended";
      camera.dispatchEvent(new Event("ended"));
    });
    expect(ui.queryByText("Live")).toBeNull();
    expect(ui.getByText("Waiting for officer camera")).toBeTruthy();
    ui.unmount();
    expect(element.srcObject).toBeNull();
    expect(camera.stop).not.toHaveBeenCalled();
    expect(microphone.stop).not.toHaveBeenCalled();
  });
  it("detaches old officers and resets playback when streams are replaced", () => {
    const stream = new Stream("first", [new Track("video"), new Track("audio")]);
    const ui = render(<OfficerFeed personId="P-01" input={input(stream)} />);
    const old = ui.getByLabelText("Officer camera feed") as HTMLVideoElement;
    fireEvent.playing(old);
    ui.rerender(<OfficerFeed personId="P-02" input={input(stream)} />);
    expect(old.srcObject).toBeNull();
    expect(ui.queryByText("Live")).toBeNull();
    expect(ui.queryByRole("button", { name: "Play feed" })).toBeNull();
    const second = new Stream("second", [new Track("audio")]);
    ui.rerender(<OfficerFeed personId="P-02" input={input(second, "P-02")} />);
    expect((ui.getByLabelText("Officer camera feed") as HTMLVideoElement).srcObject).toBe(second);
    expect(ui.getByRole("button", { name: "Play feed" })).toBeTruthy();
  });
  it("handles autoplay rejection and muted or removed remote tracks", async () => {
    const audio = new Track("audio");
    const stream = new Stream("audio-only", [audio]);
    vi.spyOn(HTMLMediaElement.prototype, "play").mockRejectedValue(new Error("blocked"));
    const ui = render(<OfficerFeed personId="P-01" input={input(stream)} />);
    fireEvent.click(ui.getByRole("button", { name: "Play feed" }));
    await waitFor(() => expect(ui.getByText("Playback paused. Try again.")).toBeTruthy());
    expect((ui.getByLabelText("Officer camera feed") as HTMLVideoElement).muted).toBe(false);
    act(() => {
      audio.muted = true;
      audio.dispatchEvent(new Event("mute"));
    });
    expect(ui.queryByRole("button", { name: "Play feed" })).toBeNull();
    act(() => {
      audio.muted = false;
      audio.dispatchEvent(new Event("unmute"));
    });
    expect(ui.getByRole("button", { name: "Play feed" })).toBeTruthy();
    act(() => {
      stream.tracks = [];
      stream.dispatchEvent(new Event("removetrack"));
    });
    expect(ui.queryByRole("button", { name: "Play feed" })).toBeNull();
  });
});
