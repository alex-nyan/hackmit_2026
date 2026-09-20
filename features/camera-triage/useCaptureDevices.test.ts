import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useCaptureDevices } from "./useCaptureDevices";

// A group id per piece of hardware: the laptop's camera and microphone
// share one, the phone's share another.
function info(kind: MediaDeviceKind, deviceId: string, label: string, groupId = deviceId) {
  return { kind, deviceId, label, groupId } as MediaDeviceInfo;
}

const webcam = info("videoinput", "webcam", "FaceTime Camera", "mac");
const phone = info("videoinput", "phone", "Alex's iPhone Camera", "iphone");
const microphone = info("audioinput", "mic", "MacBook Microphone", "mac");
const phoneMicrophone = info("audioinput", "phone-mic", "Alex's iPhone Microphone", "iphone");
const enumerateDevices = vi.fn<() => Promise<MediaDeviceInfo[]>>();
const getUserMedia = vi.fn<(constraints: MediaStreamConstraints) => Promise<MediaStream>>();
const track = { stop: vi.fn() };
let mediaDevices: EventTarget;

beforeEach(() => {
  vi.useFakeTimers();
  enumerateDevices.mockReset().mockResolvedValue([webcam, phone, microphone, phoneMicrophone]);
  track.stop.mockReset();
  getUserMedia
    .mockReset()
    .mockResolvedValue({ getTracks: () => [track] } as unknown as MediaStream);
  mediaDevices = Object.assign(new EventTarget(), { enumerateDevices, getUserMedia });
  vi.stubGlobal("navigator", { mediaDevices });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("capture device selection", () => {
  it("preselects Continuity devices and retains explicit defaults on devicechange", async () => {
    const { result } = renderHook(() => useCaptureDevices());
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(result.current.cameraId).toBe("phone");
    expect(result.current.microphoneId).toBe("phone-mic");

    act(() => {
      result.current.setCameraId(null);
      result.current.setMicrophoneId(null);
    });
    await act(async () => mediaDevices.dispatchEvent(new Event("devicechange")));
    expect(result.current.cameraId).toBeNull();
    expect(result.current.microphoneId).toBeNull();
  });

  it("resets disconnected explicit devices so the remaining devices can be acquired", async () => {
    const { result } = renderHook(() => useCaptureDevices());
    await act(async () => vi.advanceTimersByTimeAsync(0));
    act(() => {
      result.current.setCameraId("phone");
      result.current.setMicrophoneId("phone-mic");
    });

    enumerateDevices.mockResolvedValue([webcam, microphone]);
    await act(async () => mediaDevices.dispatchEvent(new Event("devicechange")));
    expect(result.current.devices.cameras).toHaveLength(1);
    expect(result.current.cameraId).toBeNull();
    expect(result.current.microphoneId).toBeNull();
  });

  it("buys the device names with a throwaway stream, then picks the iPhone", async () => {
    const anonymous = [
      info("videoinput", "webcam", "", "mac"),
      info("videoinput", "phone", "", "iphone"),
    ];
    enumerateDevices.mockResolvedValue(anonymous);
    const { result } = renderHook(() => useCaptureDevices());
    await act(async () => vi.advanceTimersByTimeAsync(0));
    // Nothing to go on yet: both cameras are anonymous until permission.
    expect(result.current.cameraId).toBeNull();

    // Granting the throwaway stream is what puts names on the list.
    getUserMedia.mockImplementation(async () => {
      enumerateDevices.mockResolvedValue([webcam, phone]);
      return { getTracks: () => [track] } as unknown as MediaStream;
    });
    let chosen: { cameraId: string | null; microphoneId: string | null } | undefined;
    await act(async () => {
      chosen = await result.current.resolveDevices();
    });
    expect(getUserMedia).toHaveBeenCalledWith({ video: true, audio: false });
    expect(track.stop).toHaveBeenCalledOnce();
    expect(chosen).toEqual({ cameraId: "phone", microphoneId: null });
    expect(result.current.cameraId).toBe("phone");
  });

  it("asks for the microphone names too when the caller needs them", async () => {
    enumerateDevices.mockResolvedValue([
      info("videoinput", "webcam", "FaceTime Camera", "mac"),
      info("audioinput", "mic", "", "mac"),
      info("audioinput", "phone-mic", "", "iphone"),
    ]);
    const { result } = renderHook(() => useCaptureDevices());
    await act(async () => vi.advanceTimersByTimeAsync(0));

    getUserMedia.mockImplementation(async () => {
      enumerateDevices.mockResolvedValue([webcam, microphone, phoneMicrophone]);
      return { getTracks: () => [track] } as unknown as MediaStream;
    });
    let chosen: { cameraId: string | null; microphoneId: string | null } | undefined;
    await act(async () => {
      chosen = await result.current.resolveDevices({ microphone: true });
    });
    // The cameras are already named, so only the microphones are worth a prompt.
    expect(getUserMedia).toHaveBeenCalledWith({ video: false, audio: true });
    expect(chosen).toEqual({ cameraId: null, microphoneId: "phone-mic" });
  });

  it("does not prompt when the names are known, or when there is nothing to tell apart", async () => {
    const { result } = renderHook(() => useCaptureDevices());
    await act(async () => vi.advanceTimersByTimeAsync(0));
    await act(async () => void (await result.current.resolveDevices({ microphone: true })));

    enumerateDevices.mockResolvedValue([info("videoinput", "webcam", "")]);
    await act(async () => mediaDevices.dispatchEvent(new Event("devicechange")));
    await act(async () => void (await result.current.resolveDevices()));
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it("keeps an explicit choice, and reports the default when permission is declined", async () => {
    enumerateDevices.mockResolvedValue([
      info("videoinput", "webcam", "", "mac"),
      info("videoinput", "phone", "", "iphone"),
    ]);
    const { result } = renderHook(() => useCaptureDevices());
    await act(async () => vi.advanceTimersByTimeAsync(0));
    act(() => result.current.setCameraId("webcam"));
    await act(async () => {
      expect(await result.current.resolveDevices()).toEqual({
        cameraId: "webcam",
        microphoneId: null,
      });
    });
    expect(getUserMedia).not.toHaveBeenCalled();

    act(() => result.current.setCameraId(undefined));
    getUserMedia.mockRejectedValue(new DOMException("Permission denied", "NotAllowedError"));
    await act(async () => {
      expect(await result.current.resolveDevices()).toEqual({
        cameraId: null,
        microphoneId: null,
      });
    });
  });

  it("ignores an older enumeration that resolves after the latest devicechange", async () => {
    const stale = Promise.withResolvers<MediaDeviceInfo[]>();
    enumerateDevices.mockReturnValueOnce(stale.promise);
    const { result } = renderHook(() => useCaptureDevices());
    await act(async () => vi.advanceTimersByTimeAsync(0));
    enumerateDevices.mockResolvedValue([webcam]);
    await act(async () => mediaDevices.dispatchEvent(new Event("devicechange")));
    await act(async () => stale.resolve([webcam, phone]));
    expect(result.current.devices.cameras).toEqual([
      { deviceId: webcam.deviceId, label: webcam.label, groupId: webcam.groupId },
    ]);
    expect(result.current.cameraId).toBeNull();
  });

  it("retains the inventory when enumeration is rejected", async () => {
    const { result } = renderHook(() => useCaptureDevices());
    await act(async () => vi.advanceTimersByTimeAsync(0));
    enumerateDevices.mockRejectedValue(new DOMException("Permission denied", "NotAllowedError"));
    await act(async () => result.current.refreshDevices());
    expect(result.current.devices.cameras).toHaveLength(2);
    expect(result.current.cameraId).toBe("phone");
  });
});
