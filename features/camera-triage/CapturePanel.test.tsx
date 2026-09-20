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

  it("shows device names revealed by permission without requiring a devicechange event", async () => {
    enumerateDevices.mockResolvedValueOnce([info("webcam", "")]);
    render(view());
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(screen.queryByRole("combobox")).toBeNull();

    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Start" })));
    expect(screen.getByRole("option", { name: phone.label })).toBeDefined();
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("");
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
