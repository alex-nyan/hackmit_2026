import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CameraTriageView } from "./CameraTriageView";
import { CapturePanel } from "./CapturePanel";

function info(deviceId: string, label: string) {
  return { kind: "videoinput", deviceId, label, groupId: "g" } as MediaDeviceInfo;
}

function captureStream() {
  const track = { stop: vi.fn(), onended: null as (() => void) | null };
  return { track, stream: { getTracks: () => [track] } as unknown as MediaStream };
}

const webcam = info("webcam", "FaceTime Camera");
const phone = info("phone", "Alex's iPhone Camera");
const enumerateDevices = vi.fn<() => Promise<MediaDeviceInfo[]>>();
const getUserMedia = vi.fn<() => Promise<MediaStream>>();
let mediaDevices: EventTarget;

beforeEach(() => {
  vi.useFakeTimers();
  enumerateDevices.mockReset().mockResolvedValue([webcam, phone]);
  getUserMedia.mockReset().mockResolvedValue(captureStream().stream);
  mediaDevices = Object.assign(new EventTarget(), { enumerateDevices, getUserMedia });
  vi.stubGlobal("navigator", { mediaDevices });
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe.each([
  ["dashboard", () => <CapturePanel sourceId="console" />],
  ["full-page", () => <CameraTriageView />],
] as const)("%s camera picker", (_name, view) => {
  it("can start the remaining camera after the selected phone disconnects", async () => {
    render(view());
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("phone");
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "phone" } });
    enumerateDevices.mockResolvedValue([webcam]);
    await act(async () => mediaDevices.dispatchEvent(new Event("devicechange")));
    expect(screen.queryByRole("combobox")).toBeNull();

    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Start" })));
    expect(getUserMedia).toHaveBeenLastCalledWith({
      video: { facingMode: "environment", width: { ideal: 1280 } },
      audio: false,
    });
  });

  it("starts on the iPhone that permission reveals, rather than the webcam", async () => {
    // A cold page sees two cameras it cannot tell apart, so it offers no picker.
    enumerateDevices.mockResolvedValueOnce([info("webcam", ""), info("phone", "")]);
    render(view());
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(screen.queryByRole("combobox")).toBeNull();

    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Start" })));
    expect(getUserMedia).toHaveBeenLastCalledWith({
      video: { deviceId: { exact: "phone" } },
      audio: false,
    });
    expect(screen.getByRole("option", { name: phone.label })).toBeDefined();
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("phone");
  });

  it("keeps the webcam when that is what the operator picked", async () => {
    render(view());
    await act(async () => vi.advanceTimersByTimeAsync(0));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "webcam" } });

    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Start" })));
    expect(getUserMedia).toHaveBeenCalledOnce();
    expect(getUserMedia).toHaveBeenLastCalledWith({
      video: { deviceId: { exact: "webcam" } },
      audio: false,
    });
  });
});

it("lets the dashboard cancel a pending microphone grant", async () => {
  const pending = Promise.withResolvers<MediaStream>();
  const microphone = captureStream();
  getUserMedia.mockReturnValue(pending.promise);
  vi.stubGlobal("MediaRecorder", {
    isTypeSupported: (mimeType: string) => mimeType.startsWith("audio/webm"),
  });
  render(<CapturePanel sourceId="console" />);
  fireEvent.click(screen.getByRole("button", { name: "Listen" }));
  expect(screen.getByText("Waiting for microphone permission…")).toBeDefined();
  fireEvent.click(screen.getByRole("button", { name: "Mute" }));
  await act(async () => pending.resolve(microphone.stream));
  expect(microphone.track.stop).toHaveBeenCalledOnce();
  expect(screen.getByRole("button", { name: "Listen" })).toBeDefined();
  expect(getUserMedia).toHaveBeenCalledOnce();
});

describe("a deployment with no triage service behind it", () => {
  beforeEach(() => {
    // The frame loop reads real pixels off the video element, which jsdom
    // does not supply on its own.
    vi.spyOn(HTMLVideoElement.prototype, "videoWidth", "get").mockReturnValue(640);
    vi.spyOn(HTMLVideoElement.prototype, "videoHeight", "get").mockReturnValue(480);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(
      "data:image/jpeg;base64,AAEC",
    );
  });

  it("says so plainly instead of reporting an error on every frame", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        status: 503,
        ok: false,
        json: async () => ({ error: "not-configured", reason: "Set TRIAGE_URL." }),
      })),
    );
    render(<CapturePanel sourceId="console" />);
    await act(async () => vi.advanceTimersByTimeAsync(0));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Start" })));
    await act(async () => vi.advanceTimersByTimeAsync(0));

    expect(screen.getByText(/No hazard triage configured here/)).toBeDefined();
    // The capture is working; nothing here is a failure.
    expect(screen.queryByText(/Triage service returned/)).toBeNull();
  });

  it("still reports a service that is genuinely failing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ status: 500, ok: false, json: async () => ({}) })),
    );
    render(<CapturePanel sourceId="console" />);
    await act(async () => vi.advanceTimersByTimeAsync(0));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Start" })));
    await act(async () => vi.advanceTimersByTimeAsync(0));

    expect(screen.getByText("Triage service returned 500.")).toBeDefined();
    expect(screen.queryByText(/No hazard triage configured/)).toBeNull();
  });
});
