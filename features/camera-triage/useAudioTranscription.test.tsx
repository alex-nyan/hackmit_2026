import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAudioTranscription } from "./useAudioTranscription";

const getUserMedia = vi.fn<() => Promise<MediaStream>>();
const fetchMock = vi.fn<typeof fetch>();
const transcript = { request_id: "r1", text: "hello", speech_detected: true };

function microphone() {
  const track = { stop: vi.fn(), onended: null as (() => void) | null };
  return { track, stream: { getTracks: () => [track] } as unknown as MediaStream };
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
    if (RecorderMock.failStart) throw new Error("Recorder failed");
    this.state = "recording";
  });
  stop = vi.fn(() => {
    this.state = "inactive";
    // Like the browser, stop queues final data and then the stop event.
    queueMicrotask(() => {
      this.ondataavailable?.({ data: new Blob(["complete webm"], { type: this.mimeType }) });
      this.onstop?.();
    });
  });
  constructor() {
    RecorderMock.instances.push(this);
  }
}

class ReaderMock {
  static instances: ReaderMock[] = [];
  static autoComplete = true;
  blob: Blob | null = null;
  result: string | null = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() {
    ReaderMock.instances.push(this);
  }
  readAsDataURL(blob: Blob) {
    this.blob = blob;
    if (ReaderMock.autoComplete) queueMicrotask(() => this.finish());
  }
  finish() {
    // FileReader preserves the recorder's codec parameters in the data URL.
    this.result = `data:${this.blob!.type};base64,GkXfow==`;
    this.onload?.();
  }
}

async function finishClip() {
  await act(async () => vi.advanceTimersByTimeAsync(10_000));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-19T21:00:00Z"));
  RecorderMock.instances = [];
  RecorderMock.failStart = false;
  ReaderMock.instances = [];
  ReaderMock.autoComplete = true;
  getUserMedia.mockReset();
  fetchMock.mockReset().mockImplementation(async () => Response.json(transcript));
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
  vi.stubGlobal("MediaRecorder", RecorderMock);
  vi.stubGlobal("FileReader", ReaderMock);
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("audio acquisition lifecycle", () => {
  it.each(["stop", "unmount", "background"] as const)(
    "releases a microphone granted after %s",
    async (action) => {
      const pending = Promise.withResolvers<MediaStream>();
      const mic = microphone();
      getUserMedia.mockReturnValue(pending.promise);
      const { result, unmount } = renderHook(() => useAudioTranscription("unit-01"));
      let starting!: Promise<void>;
      act(() => {
        starting = result.current.start();
      });
      expect(result.current.state.state).toBe("requesting-microphone");
      act(() => {
        if (action === "unmount") unmount();
        else if (action === "stop") result.current.stop();
        else {
          vi.spyOn(document, "hidden", "get").mockReturnValue(true);
          document.dispatchEvent(new Event("visibilitychange"));
        }
      });
      await act(async () => {
        pending.resolve(mic.stream);
        await starting;
      });
      expect(mic.track.stop).toHaveBeenCalledOnce();
      expect(RecorderMock.instances).toHaveLength(0);
      if (action !== "unmount") expect(result.current.state.state).toBe("off");
    },
  );

  it("admits only one start while permission is pending", async () => {
    const pending = Promise.withResolvers<MediaStream>();
    const mic = microphone();
    getUserMedia.mockReturnValue(pending.promise);
    const { result } = renderHook(() => useAudioTranscription("unit-01"));
    let starting!: Promise<void>;
    act(() => {
      starting = result.current.start();
      void result.current.start();
    });
    expect(getUserMedia).toHaveBeenCalledOnce();
    await act(async () => {
      pending.resolve(mic.stream);
      await starting;
    });
    expect(RecorderMock.instances).toHaveLength(1);
  });

  it.each(["resolve", "reject"] as const)(
    "keeps a new session intact when an old permission request settles: %s",
    async (outcome) => {
      const pending = Promise.withResolvers<MediaStream>();
      const oldMic = microphone();
      const newMic = microphone();
      getUserMedia.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(newMic.stream);
      const { result } = renderHook(() => useAudioTranscription("unit-01"));
      let starting!: Promise<void>;
      act(() => {
        starting = result.current.start();
      });
      act(() => result.current.stop());
      await act(async () => result.current.start());
      await act(async () => {
        if (outcome === "resolve") pending.resolve(oldMic.stream);
        else pending.reject(new Error("Permission denied"));
        await starting;
      });
      expect(result.current.state.state).toBe("recording");
      expect(newMic.track.stop).not.toHaveBeenCalled();
      if (outcome === "resolve") expect(oldMic.track.stop).toHaveBeenCalledOnce();
    },
  );

  it("releases the stream if MediaRecorder fails to start", async () => {
    const mic = microphone();
    getUserMedia.mockResolvedValue(mic.stream);
    RecorderMock.failStart = true;
    const { result } = renderHook(() => useAudioTranscription("unit-01"));
    await act(async () => result.current.start());
    expect(result.current.state.state).toBe("unsupported");
    expect(mic.track.stop).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("complete audio clips", () => {
  it("finalizes each container and starts a fresh recording for every upload", async () => {
    const mic = microphone();
    getUserMedia.mockResolvedValue(mic.stream);
    const { result, rerender } = renderHook(({ source }) => useAudioTranscription(source), {
      initialProps: { source: "unit-01" },
    });
    await act(async () => result.current.start());
    const first = RecorderMock.instances[0];
    expect(first.start).toHaveBeenCalledWith();
    rerender({ source: "unit-02" });
    await finishClip();
    expect(first.stop).toHaveBeenCalledOnce();
    expect(RecorderMock.instances).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledOnce();
    const firstBody = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
    expect(firstBody).toMatchObject({
      source_id: "unit-01",
      captured_at: "2026-09-19T21:00:00.000Z",
      media_type: "audio/webm",
    });
    await finishClip();
    expect(RecorderMock.instances[1].stop).toHaveBeenCalledOnce();
    expect(RecorderMock.instances).toHaveLength(3);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[1][1]!.body as string)).toMatchObject({
      source_id: "unit-02",
      captured_at: "2026-09-19T21:00:10.000Z",
    });
    expect(mic.track.stop).not.toHaveBeenCalled();
  });

  it("drops complete clips while an upload is pending", async () => {
    const pending = Promise.withResolvers<Response>();
    getUserMedia.mockResolvedValue(microphone().stream);
    fetchMock.mockReturnValueOnce(pending.promise);
    const { result } = renderHook(() => useAudioTranscription("unit-01"));
    await act(async () => result.current.start());
    await finishClip();
    await finishClip();
    expect(fetchMock).toHaveBeenCalledOnce();
    await act(async () => pending.resolve(Response.json(transcript)));
    await finishClip();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not upload a clip whose FileReader settles after Stop", async () => {
    ReaderMock.autoComplete = false;
    getUserMedia.mockResolvedValue(microphone().stream);
    const { result } = renderHook(() => useAudioTranscription("unit-01"));
    await act(async () => result.current.start());
    await finishClip();
    expect(ReaderMock.instances).toHaveLength(1);
    act(() => result.current.stop());
    await act(async () => ReaderMock.instances[0].finish());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("aborts an old upload and ignores its result after a new session starts", async () => {
    const pending = Promise.withResolvers<Response>();
    getUserMedia.mockImplementation(async () => microphone().stream);
    fetchMock.mockReturnValueOnce(pending.promise);
    const { result } = renderHook(() => useAudioTranscription("unit-01"));
    await act(async () => result.current.start());
    await finishClip();
    const signal = fetchMock.mock.calls[0][1]!.signal;
    act(() => result.current.stop());
    expect(signal?.aborted).toBe(true);
    await act(async () => result.current.start());
    await act(async () => pending.resolve(Response.json(transcript)));
    expect(result.current.state).toEqual({
      state: "recording",
      lastResult: null,
      lastError: null,
    });
    await finishClip();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each(["stop", "unmount", "background", "error", "ended"] as const)(
    "cleans up active recording on %s without sending a final clip",
    async (action) => {
      const mic = microphone();
      getUserMedia.mockResolvedValue(mic.stream);
      const { result, unmount } = renderHook(() => useAudioTranscription("unit-01"));
      await act(async () => result.current.start());
      const recorder = RecorderMock.instances[0];
      await act(async () => {
        if (action === "stop") result.current.stop();
        else if (action === "unmount") unmount();
        else if (action === "error") recorder.onerror?.();
        else if (action === "ended") mic.track.onended?.();
        else {
          vi.spyOn(document, "hidden", "get").mockReturnValue(true);
          document.dispatchEvent(new Event("visibilitychange"));
        }
      });
      expect(mic.track.stop).toHaveBeenCalledOnce();
      expect(recorder.stop).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(RecorderMock.instances).toHaveLength(1);
    },
  );
});
