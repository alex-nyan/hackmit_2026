import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useCameraTriage } from "./useCameraTriage";

const getUserMedia = vi.fn<() => Promise<MediaStream>>();

function cameraStream() {
  const stop = vi.fn();
  const stream = { getTracks: () => [{ stop }] } as unknown as MediaStream;
  return { stream, stop };
}

beforeEach(() => {
  vi.useFakeTimers();
  getUserMedia.mockReset();
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("camera acquisition lifecycle", () => {
  it.each(["stop", "unmount"] as const)("releases a camera granted after %s", async (action) => {
    const acquisition = Promise.withResolvers<MediaStream>();
    const camera = cameraStream();
    getUserMedia.mockReturnValue(acquisition.promise);
    const { result, unmount } = renderHook(() => useCameraTriage({ sourceId: "unit-01" }));
    let starting!: Promise<void>;
    act(() => {
      starting = result.current.start();
    });
    act(() => {
      if (action === "stop") result.current.stop();
      else unmount();
    });

    await act(async () => {
      acquisition.resolve(camera.stream);
      await starting;
    });

    expect(camera.stop).toHaveBeenCalledOnce();
    if (action === "stop") expect(result.current.state.state).toBe("idle");
  });

  it("admits only one Start while camera permission is pending", async () => {
    const acquisition = Promise.withResolvers<MediaStream>();
    const camera = cameraStream();
    getUserMedia.mockReturnValue(acquisition.promise);
    const { result } = renderHook(() => useCameraTriage({ sourceId: "unit-01" }));
    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => {
      first = result.current.start();
      second = result.current.start();
    });

    expect(getUserMedia).toHaveBeenCalledOnce();
    await act(async () => {
      acquisition.resolve(camera.stream);
      await Promise.all([first, second]);
    });
    expect(result.current.state.state).toBe("running");
    act(() => result.current.stop());
    expect(camera.stop).toHaveBeenCalledOnce();
  });

  it("does not restart capture when playback settles after Stop", async () => {
    const playback = Promise.withResolvers<void>();
    const camera = cameraStream();
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockReturnValue(playback.promise);
    getUserMedia.mockResolvedValue(camera.stream);
    const { result } = renderHook(() => useCameraTriage({ sourceId: "unit-01" }));
    const video = document.createElement("video");
    result.current.videoRef.current = video;
    let starting!: Promise<void>;
    await act(async () => {
      starting = result.current.start();
    });
    expect(play).toHaveBeenCalledOnce();

    act(() => result.current.stop());
    await act(async () => {
      playback.resolve();
      await starting;
    });

    expect(camera.stop).toHaveBeenCalledOnce();
    expect(video.srcObject).toBeNull();
    expect(result.current.state.state).toBe("idle");
  });

  it("keeps a new session intact when an earlier acquisition resolves", async () => {
    const oldAcquisition = Promise.withResolvers<MediaStream>();
    const oldCamera = cameraStream();
    const newCamera = cameraStream();
    getUserMedia
      .mockReturnValueOnce(oldAcquisition.promise)
      .mockResolvedValueOnce(newCamera.stream);
    const { result } = renderHook(() => useCameraTriage({ sourceId: "unit-01" }));
    let oldStart!: Promise<void>;
    act(() => {
      oldStart = result.current.start();
    });
    act(() => result.current.stop());
    await act(async () => result.current.start());
    await act(async () => {
      oldAcquisition.resolve(oldCamera.stream);
      await oldStart;
    });

    expect(oldCamera.stop).toHaveBeenCalledOnce();
    expect(newCamera.stop).not.toHaveBeenCalled();
    expect(result.current.state.state).toBe("running");
    act(() => result.current.stop());
    expect(newCamera.stop).toHaveBeenCalledOnce();
  });

  it("ignores a permission rejection from a stopped session", async () => {
    const oldAcquisition = Promise.withResolvers<MediaStream>();
    const newCamera = cameraStream();
    getUserMedia
      .mockReturnValueOnce(oldAcquisition.promise)
      .mockResolvedValueOnce(newCamera.stream);
    const { result } = renderHook(() => useCameraTriage({ sourceId: "unit-01" }));
    let oldStart!: Promise<void>;
    act(() => {
      oldStart = result.current.start();
    });
    act(() => result.current.stop());
    await act(async () => result.current.start());
    await act(async () => {
      oldAcquisition.reject(new DOMException("Permission declined", "NotAllowedError"));
      await oldStart;
    });

    expect(result.current.state.state).toBe("running");
    expect(newCamera.stop).not.toHaveBeenCalled();
  });

  it("stops the camera when the tab goes into the background", async () => {
    const camera = cameraStream();
    getUserMedia.mockResolvedValue(camera.stream);
    const { result } = renderHook(() => useCameraTriage({ sourceId: "unit-01" }));
    await act(async () => result.current.start());
    expect(result.current.state.state).toBe("running");

    vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    act(() => document.dispatchEvent(new Event("visibilitychange")));

    expect(camera.stop).toHaveBeenCalledOnce();
    expect(result.current.state.state).toBe("idle");
  });
});
