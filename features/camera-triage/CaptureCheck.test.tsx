import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CaptureCheck } from "./CaptureCheck";

const getUserMedia = vi.fn<() => Promise<MediaStream>>();
const enumerateDevices = vi.fn(async () => []);
const createObjectURL = vi.fn<(blob: Blob) => string>(() => "blob:local-clip");
const revokeObjectURL = vi.fn();
const fetchMock = vi.fn();

class StreamMock {
  constructor(private tracks: MediaStreamTrack[] = []) {}
  getTracks() {
    return this.tracks;
  }
  getAudioTracks() {
    return this.tracks.filter((track) => track.kind === "audio");
  }
  getVideoTracks() {
    return this.tracks.filter((track) => track.kind === "video");
  }
}

function capture() {
  const camera = {
    kind: "video",
    label: "Test camera",
    stop: vi.fn(),
    onended: null as (() => void) | null,
  };
  const microphone = {
    kind: "audio",
    label: "Test microphone",
    stop: vi.fn(),
    onended: null as (() => void) | null,
  };
  const stream = new StreamMock([camera, microphone] as unknown as MediaStreamTrack[]);
  return { camera, microphone, stream: stream as unknown as MediaStream };
}

class AudioContextMock {
  static instances: AudioContextMock[] = [];
  static fail = false;
  close = vi.fn(async () => {});
  createAnalyser = () => ({
    fftSize: 512,
    frequencyBinCount: 256,
    getByteTimeDomainData: (samples: Uint8Array) => samples.fill(128),
  });
  createMediaStreamSource = () => ({ connect: vi.fn() });
  constructor() {
    if (AudioContextMock.fail) throw new Error("Audio setup failed");
    AudioContextMock.instances.push(this);
  }
}

class RecorderMock {
  static instances: RecorderMock[] = [];
  static failStart = false;
  static isTypeSupported = (mimeType: string) => mimeType.startsWith("audio/webm");
  state = "inactive";
  mimeType = "audio/webm;codecs=opus";
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  start = vi.fn(() => {
    if (RecorderMock.failStart) throw new Error("Recorder setup failed");
    this.state = "recording";
  });
  stop = vi.fn(() => {
    this.state = "inactive";
    queueMicrotask(() => {
      this.ondataavailable?.({ data: new Blob(["local audio"], { type: this.mimeType }) });
      this.onstop?.();
    });
  });
  constructor(public stream: MediaStream) {
    RecorderMock.instances.push(this);
  }
}

async function mount() {
  const result = render(<CaptureCheck />);
  await act(async () => vi.advanceTimersByTimeAsync(0));
  return result;
}

async function start() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Test camera and microphone" }));
  });
}

function interrupt(action: "stop" | "unmount" | "background", unmount: () => void) {
  act(() => {
    if (action === "unmount") unmount();
    else if (action === "stop") fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    else {
      vi.spyOn(document, "hidden", "get").mockReturnValue(true);
      document.dispatchEvent(new Event("visibilitychange"));
    }
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  RecorderMock.instances = [];
  RecorderMock.failStart = false;
  AudioContextMock.instances = [];
  AudioContextMock.fail = false;
  getUserMedia.mockReset();
  enumerateDevices.mockClear();
  createObjectURL.mockClear();
  revokeObjectURL.mockClear();
  fetchMock.mockClear();
  const mediaDevices = Object.assign(new EventTarget(), { getUserMedia, enumerateDevices });
  vi.stubGlobal("navigator", { mediaDevices });
  vi.stubGlobal("MediaStream", StreamMock);
  vi.stubGlobal("MediaRecorder", RecorderMock);
  vi.stubGlobal("AudioContext", AudioContextMock);
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn(() => 1),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = createObjectURL;
      static revokeObjectURL = revokeObjectURL;
    },
  );
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("capture check session lifecycle", () => {
  it.each(["stop", "unmount", "background"] as const)(
    "releases permission granted after %s",
    async (action) => {
      const pending = Promise.withResolvers<MediaStream>();
      const media = capture();
      getUserMedia.mockReturnValue(pending.promise);
      const { unmount } = await mount();
      await start();
      interrupt(action, unmount);
      await act(async () => pending.resolve(media.stream));
      expect(media.camera.stop).toHaveBeenCalledOnce();
      expect(media.microphone.stop).toHaveBeenCalledOnce();
      expect(RecorderMock.instances).toHaveLength(0);
      expect(AudioContextMock.instances).toHaveLength(0);
    },
  );

  it("admits only one acquisition while permission is pending", async () => {
    const pending = Promise.withResolvers<MediaStream>();
    getUserMedia.mockReturnValue(pending.promise);
    await mount();
    const button = screen.getByRole("button", { name: "Test camera and microphone" });
    // The second click is refused before the device list is even asked for.
    await act(async () => {
      fireEvent.click(button);
      fireEvent.click(button);
    });
    expect(getUserMedia).toHaveBeenCalledOnce();
    await act(async () => pending.resolve(capture().stream));
  });

  it.each(["stop", "unmount", "background"] as const)(
    "does not restart audio when video playback settles after %s",
    async (action) => {
      const pending = Promise.withResolvers<void>();
      vi.mocked(HTMLMediaElement.prototype.play).mockReturnValueOnce(pending.promise);
      const media = capture();
      getUserMedia.mockResolvedValue(media.stream);
      const { unmount } = await mount();
      await start();
      interrupt(action, unmount);
      await act(async () => pending.resolve());
      expect(media.camera.stop).toHaveBeenCalledOnce();
      expect(media.microphone.stop).toHaveBeenCalledOnce();
      expect(RecorderMock.instances).toHaveLength(0);
      expect(AudioContextMock.instances).toHaveLength(0);
    },
  );

  it.each(["stop", "unmount", "background"] as const)(
    "releases every active resource on %s and ignores queued recorder events",
    async (action) => {
      const media = capture();
      getUserMedia.mockResolvedValue(media.stream);
      const { unmount } = await mount();
      await start();
      const recorder = RecorderMock.instances[0];
      const staleStop = recorder.onstop;
      interrupt(action, unmount);
      await act(async () => staleStop?.());
      expect(recorder.stop).toHaveBeenCalledOnce();
      expect(AudioContextMock.instances[0].close).toHaveBeenCalledOnce();
      expect(cancelAnimationFrame).toHaveBeenCalledWith(1);
      expect(media.camera.stop).toHaveBeenCalledOnce();
      expect(media.microphone.stop).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
      expect(createObjectURL).not.toHaveBeenCalled();
    },
  );

  it.each(["resolve", "reject"] as const)(
    "keeps the new session intact when old permission settles: %s",
    async (outcome) => {
      const pending = Promise.withResolvers<MediaStream>();
      const previous = capture();
      const current = capture();
      getUserMedia.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(current.stream);
      const { unmount } = await mount();
      await start();
      interrupt("stop", unmount);
      await start();
      await act(async () => {
        if (outcome === "resolve") pending.resolve(previous.stream);
        else pending.reject(new Error("Old permission failed"));
      });
      expect(screen.getByRole("button", { name: "Stop" })).toBeTruthy();
      expect(current.camera.stop).not.toHaveBeenCalled();
      expect(current.microphone.stop).not.toHaveBeenCalled();
      if (outcome === "resolve") {
        expect(previous.camera.stop).toHaveBeenCalledOnce();
        expect(previous.microphone.stop).toHaveBeenCalledOnce();
      }
    },
  );

  it.each(["audio context", "recorder"] as const)(
    "releases the camera and microphone after a %s setup failure",
    async (failure) => {
      AudioContextMock.fail = failure === "audio context";
      RecorderMock.failStart = failure === "recorder";
      const media = capture();
      getUserMedia.mockResolvedValue(media.stream);
      await mount();
      await start();
      expect(screen.getByText("Capture failed (Error).")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Test camera and microphone" })).toBeTruthy();
      expect(media.camera.stop).toHaveBeenCalledOnce();
      expect(media.microphone.stop).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
      if (failure === "recorder") {
        expect(AudioContextMock.instances[0].close).toHaveBeenCalledOnce();
        expect(cancelAnimationFrame).toHaveBeenCalledOnce();
      }
    },
  );

  it.each(["recorder", "camera", "microphone"] as const)(
    "releases capture if the %s fails or disconnects",
    async (failure) => {
      const media = capture();
      getUserMedia.mockResolvedValue(media.stream);
      await mount();
      await start();
      act(() => {
        if (failure === "recorder") RecorderMock.instances[0].onerror?.();
        else media[failure].onended?.();
      });
      expect(media.camera.stop).toHaveBeenCalledOnce();
      expect(media.microphone.stop).toHaveBeenCalledOnce();
      expect(AudioContextMock.instances[0].close).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
      expect(screen.getByRole("button", { name: "Test camera and microphone" })).toBeTruthy();
    },
  );
});

describe("local recording", () => {
  it("records only audio, never uploads, and revokes clips on restart and unmount", async () => {
    const media = capture();
    getUserMedia.mockResolvedValue(media.stream);
    const { container, unmount } = await mount();
    await start();
    const recorder = RecorderMock.instances[0];
    expect(recorder.stream.getTracks()).toEqual([media.microphone]);
    await act(async () => vi.advanceTimersByTimeAsync(5000));
    expect(createObjectURL).toHaveBeenCalledOnce();
    const recordedBlob = createObjectURL.mock.calls[0][0] as Blob;
    expect(recordedBlob.type).toBe(recorder.mimeType);
    expect(recordedBlob.size).toBeGreaterThan(0);
    expect(container.querySelector("audio")?.getAttribute("src")).toBe("blob:local-clip");
    expect(fetchMock).not.toHaveBeenCalled();
    interrupt("stop", unmount);
    await start();
    expect(revokeObjectURL).toHaveBeenCalledOnce();
    await act(async () => vi.advanceTimersByTimeAsync(5000));
    unmount();
    expect(revokeObjectURL).toHaveBeenCalledTimes(2);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("can test capture without MediaRecorder", async () => {
    vi.stubGlobal("MediaRecorder", undefined);
    getUserMedia.mockResolvedValue(capture().stream);
    await mount();
    await start();
    expect(screen.getByRole("button", { name: "Stop" })).toBeTruthy();
    expect(screen.queryByText(/Capture failed/)).toBeNull();
  });
});
