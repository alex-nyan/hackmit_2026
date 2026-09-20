import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useCaptureDevices } from "./useCaptureDevices";

function info(kind: MediaDeviceKind, deviceId: string, label: string) {
  return { kind, deviceId, label, groupId: "g" } as MediaDeviceInfo;
}

const webcam = info("videoinput", "webcam", "FaceTime Camera");
const phone = info("videoinput", "phone", "Alex's iPhone Camera");
const microphone = info("audioinput", "mic", "MacBook Microphone");
const phoneMicrophone = info("audioinput", "phone-mic", "Alex's iPhone Microphone");
const enumerateDevices = vi.fn<() => Promise<MediaDeviceInfo[]>>();
let mediaDevices: EventTarget;

beforeEach(() => {
  vi.useFakeTimers();
  enumerateDevices.mockReset().mockResolvedValue([webcam, phone, microphone, phoneMicrophone]);
  mediaDevices = Object.assign(new EventTarget(), { enumerateDevices });
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

  it("refreshes permission-revealed labels without changing the acquisition choice", async () => {
    enumerateDevices.mockResolvedValue([info("videoinput", "webcam", "")]);
    const { result } = renderHook(() => useCaptureDevices());
    await act(async () => vi.advanceTimersByTimeAsync(0));
    act(() => result.current.setCameraId(result.current.cameraId));

    enumerateDevices.mockResolvedValue([webcam, phone]);
    await act(async () => result.current.refreshDevices());
    expect(result.current.devices.cameras.map((device) => device.label)).toEqual([
      webcam.label,
      phone.label,
    ]);
    expect(result.current.cameraId).toBeNull();
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
      { deviceId: webcam.deviceId, label: webcam.label },
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
