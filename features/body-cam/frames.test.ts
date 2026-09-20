import { describe, expect, it } from "vitest";

import {
  ageMs,
  decodeFrame,
  framePath,
  isStale,
  jpegBytes,
  parseFrameSubmission,
  sourceIdFromPath,
} from "./frames";

const JPEG = "/9j/4AAQSkZJRg==";

function submission(overrides: Record<string, unknown> = {}) {
  return {
    image_base64: JPEG,
    media_type: "image/jpeg",
    source_id: "unit-02",
    captured_at: "2026-09-19T12:00:00.000Z",
    ...overrides,
  };
}

describe("reading a triage body as a wall submission", () => {
  it("accepts the payload the capture page already uploads", () => {
    expect(parseFrameSubmission(submission())).toEqual({
      sourceId: "unit-02",
      base64: JPEG,
      capturedAt: "2026-09-19T12:00:00.000Z",
    });
  });

  it("refuses a source id the triage service would itself reject", () => {
    expect(parseFrameSubmission(submission({ source_id: "unit 02" }))).toBeNull();
    expect(parseFrameSubmission(submission({ source_id: "" }))).toBeNull();
  });

  it("refuses anything that is not a JPEG frame", () => {
    expect(parseFrameSubmission(submission({ media_type: "image/png" }))).toBeNull();
    expect(parseFrameSubmission(submission({ image_base64: "not base64!" }))).toBeNull();
    expect(parseFrameSubmission(submission({ image_base64: "" }))).toBeNull();
  });

  it("keeps a capture time only when it is a real one", () => {
    expect(parseFrameSubmission(submission({ captured_at: "whenever" }))?.capturedAt).toBeNull();
    expect(parseFrameSubmission(submission({ captured_at: 12 }))?.capturedAt).toBeNull();
  });

  it("refuses a body that is not an object at all", () => {
    expect(parseFrameSubmission(null)).toBeNull();
    expect(parseFrameSubmission("frame")).toBeNull();
  });
});

describe("frame size", () => {
  it("reports decoded bytes rather than base64 length", () => {
    expect(jpegBytes("AAAA")).toBe(3);
    expect(jpegBytes("AAA=")).toBe(2);
    expect(jpegBytes("AA==")).toBe(1);
    expect(jpegBytes("")).toBe(0);
  });
});

describe("naming an officer's object", () => {
  it("gives each officer one stable path, so a new frame replaces the old", () => {
    expect(framePath("unit-02")).toBe("frames/unit-02.jpg");
    expect(sourceIdFromPath(framePath("unit-02"))).toBe("unit-02");
  });

  it("refuses a path that is not one of ours", () => {
    expect(sourceIdFromPath("other/unit-02.jpg")).toBeNull();
    expect(sourceIdFromPath("frames/unit-02.png")).toBeNull();
    // A name the triage service would itself reject cannot round-trip.
    expect(sourceIdFromPath("frames/unit 02.jpg")).toBeNull();
    expect(sourceIdFromPath("frames/.jpg")).toBeNull();
  });
});

describe("age", () => {
  const now = Date.parse("2026-09-19T12:00:10.000Z");

  it("measures from the store's clock, not the publisher's", () => {
    expect(ageMs({ at: "2026-09-19T12:00:00.000Z" }, now)).toBe(10_000);
  });

  it("treats an unreadable timestamp as infinitely old, never as current", () => {
    expect(ageMs({ at: "not a date" }, now)).toBe(Number.POSITIVE_INFINITY);
    expect(isStale("not a date", now, 20_000)).toBe(true);
  });

  it("calls a frame stale only once it is past the limit", () => {
    expect(isStale("2026-09-19T12:00:00.000Z", now, 10_000)).toBe(false);
    expect(isStale("2026-09-19T12:00:00.000Z", now, 9_999)).toBe(true);
  });
});

describe("decoding", () => {
  it("round-trips the bytes a browser would draw", () => {
    expect([...decodeFrame("AAEC")]).toEqual([0, 1, 2]);
  });
});
