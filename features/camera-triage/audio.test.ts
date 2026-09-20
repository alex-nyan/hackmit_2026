import { describe, expect, it } from "vitest";

import {
  MAX_AUDIO_BASE64,
  RECORDER_MIME_CANDIDATES,
  buildTranscriptionRequest,
  describeTranscript,
  pickRecorderMimeType,
  stripAudioDataUrl,
  toServiceMediaType,
  type TranscriptionResult,
} from "./audio";

const CAPTURED_AT = new Date("2026-09-19T21:00:00.000Z");
const DATA_URL = "data:audio/mp4;base64,AAABBBCCC==";

function result(overrides: Partial<TranscriptionResult> = {}): TranscriptionResult {
  return {
    request_id: "r1",
    text: "dispatch we need backup",
    speech_detected: true,
    language: "en",
    language_probability: 0.98,
    duration_seconds: 10,
    segments: [],
    warnings: [],
    ...overrides,
  };
}

describe("recorder format selection", () => {
  it("prefers MP4, which is what Safari can actually record", () => {
    // A WebM-first list would silently record nothing on an iPhone.
    expect(pickRecorderMimeType(() => true)).toBe("audio/mp4");
    expect(RECORDER_MIME_CANDIDATES[0]).toBe("audio/mp4");
  });

  it("falls back to a format the browser supports", () => {
    const chromeOnly = (candidate: string) => candidate.startsWith("audio/webm");
    expect(pickRecorderMimeType(chromeOnly)).toBe("audio/webm;codecs=opus");
  });

  it("returns null when nothing is recordable, rather than guessing", () => {
    expect(pickRecorderMimeType(() => false)).toBeNull();
  });

  it("never picks a format the service would reject", () => {
    expect(pickRecorderMimeType(() => true, ["audio/flac", "audio/amr"])).toBeNull();
  });
});

describe("media types", () => {
  it("reduces a codec-qualified type to what the service accepts", () => {
    expect(toServiceMediaType("audio/mp4;codecs=mp4a.40.2")).toBe("audio/mp4");
    expect(toServiceMediaType("audio/webm;codecs=opus")).toBe("audio/webm");
    expect(toServiceMediaType("AUDIO/WAV")).toBe("audio/wav");
    expect(toServiceMediaType("audio/x-m4a")).toBe("audio/mp4");
  });

  it("rejects a type outside the contract", () => {
    expect(toServiceMediaType("audio/flac")).toBeNull();
    expect(toServiceMediaType("video/mp4")).toBeNull();
    expect(toServiceMediaType("")).toBeNull();
  });
});

describe("data urls", () => {
  it("strips whatever prefix FileReader produced", () => {
    expect(stripAudioDataUrl(DATA_URL)).toBe("AAABBBCCC==");
    expect(stripAudioDataUrl("data:audio/webm;base64,ZZZ=")).toBe("ZZZ=");
  });

  it("accepts codec parameters preserved from MediaRecorder blobs", () => {
    expect(stripAudioDataUrl("data:audio/webm;codecs=opus;base64,ZZZ=")).toBe("ZZZ=");
    expect(stripAudioDataUrl("data:audio/mp4;codecs=mp4a.40.2;base64,ZZZ=")).toBe("ZZZ=");
  });

  it("rejects anything that is not a base64 data url", () => {
    expect(stripAudioDataUrl("AAABBB")).toBeNull();
    expect(stripAudioDataUrl("")).toBeNull();
  });
});

describe("request body", () => {
  it("matches the service contract", () => {
    expect(
      buildTranscriptionRequest({
        dataUrl: DATA_URL,
        recorderMimeType: "audio/mp4;codecs=mp4a.40.2",
        sourceId: "Unit 02",
        capturedAt: CAPTURED_AT,
      }),
    ).toEqual({
      audio_base64: "AAABBBCCC==",
      media_type: "audio/mp4",
      source_id: "Unit-02",
      captured_at: "2026-09-19T21:00:00.000Z",
      incident_id: null,
      language: null,
    });
  });

  it("carries a language hint when one is given", () => {
    const body = buildTranscriptionRequest({
      dataUrl: DATA_URL,
      recorderMimeType: "audio/mp4",
      sourceId: "unit-01",
      capturedAt: CAPTURED_AT,
      language: "es",
    });
    expect(body?.language).toBe("es");
  });

  it("refuses a clip the service would reject as oversized", () => {
    const huge = `data:audio/mp4;base64,${"A".repeat(MAX_AUDIO_BASE64 + 1)}`;
    expect(
      buildTranscriptionRequest({
        dataUrl: huge,
        recorderMimeType: "audio/mp4",
        sourceId: "unit-01",
        capturedAt: CAPTURED_AT,
      }),
    ).toBeNull();
  });

  it("refuses a format outside the contract instead of mislabelling it", () => {
    expect(
      buildTranscriptionRequest({
        dataUrl: "data:audio/flac;base64,AAA=",
        recorderMimeType: "audio/flac",
        sourceId: "unit-01",
        capturedAt: CAPTURED_AT,
      }),
    ).toBeNull();
  });
});

describe("describing a transcript", () => {
  it("shows recognised speech", () => {
    expect(describeTranscript(result())).toBe("dispatch we need backup");
  });

  it("says nothing was recognised rather than showing an empty quote", () => {
    // Silence and unrecognised speech are not the same claim.
    expect(describeTranscript(result({ text: "", speech_detected: false }))).toBe(
      "No speech recognised in this clip.",
    );
  });

  it("does not present empty text as speech even if the flag disagrees", () => {
    expect(describeTranscript(result({ text: "", speech_detected: true }))).toBe(
      "No speech recognised in this clip.",
    );
  });
});
