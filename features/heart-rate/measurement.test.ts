import { describe, expect, it, vi } from "vitest";
import { parseHeartRateMeasurement } from "./measurement";

const value = (...bytes: number[]) => new DataView(Uint8Array.from(bytes).buffer);

describe("Bluetooth heart rate measurement", () => {
  it("reads 8-bit and little-endian 16-bit values", () => {
    expect(parseHeartRateMeasurement(value(0, 72))).toEqual({ kind: "reading", bpm: 72 });
    expect(parseHeartRateMeasurement(value(1, 44, 1))).toEqual({ kind: "reading", bpm: 300 });
  });
  it("accepts optional energy and multiple RR intervals without treating them as BPM", () => {
    expect(parseHeartRateMeasurement(value(0x18, 81, 8, 0, 4, 0, 9, 0))).toEqual({
      kind: "reading",
      bpm: 81,
    });
  });
  it("respects supported sensor contact flags, but does not require contact support", () => {
    expect(parseHeartRateMeasurement(value(4, 81))).toEqual({ kind: "no-contact" });
    expect(parseHeartRateMeasurement(value(6, 81))).toEqual({ kind: "reading", bpm: 81 });
    expect(parseHeartRateMeasurement(value(0, 81))).toEqual({ kind: "reading", bpm: 81 });
  });
  it.each([[], [0], [1, 90], [8, 90], [8, 90, 0], [16, 90], [16, 90, 1], [0, 90, 1], [0, 0]])(
    "rejects malformed or unusable packet %j",
    (...bytes) => {
      expect(parseHeartRateMeasurement(value(...bytes))).toEqual({ kind: "invalid" });
    },
  );
  it("handles missing values and DataView byte offsets", () => {
    expect(parseHeartRateMeasurement()).toEqual({ kind: "invalid" });
    const buffer = Uint8Array.from([255, 1, 44, 1, 255]).buffer;
    expect(parseHeartRateMeasurement(new DataView(buffer, 1, 3))).toEqual({
      kind: "reading",
      bpm: 300,
    });
  });
  it("treats unreadable buffers as invalid instead of throwing", () => {
    const reading = value(0, 72);
    vi.spyOn(reading, "getUint8").mockImplementation(() => {
      throw new TypeError("detached");
    });
    expect(parseHeartRateMeasurement(reading)).toEqual({ kind: "invalid" });
  });
});
