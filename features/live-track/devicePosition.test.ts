import { describe, expect, it } from "vitest";

import {
  DROP_AFTER_MS,
  MAX_SOURCES,
  activePositions,
  mergePosition,
  parsePositionSubmission,
  storePosition,
  toLiveDevice,
  type PositionSubmission,
  type StoredPosition,
} from "./devicePosition";

const NOW = Date.parse("2026-09-20T12:00:00.000Z");

function submission(overrides: Partial<PositionSubmission> = {}): PositionSubmission {
  return {
    sourceId: "unit-01",
    name: "Unit 01",
    longitude: -71.092,
    latitude: 42.36,
    accuracyMeters: 12,
    speedKmh: 0,
    headingDegrees: null,
    fixedAt: "2026-09-20T11:59:58.000Z",
    ...overrides,
  };
}

function stored(overrides: Partial<StoredPosition> = {}): StoredPosition {
  return { ...submission(), publishedAt: new Date(NOW).toISOString(), ...overrides };
}

function body(overrides: Record<string, unknown> = {}) {
  return {
    sourceId: "unit-01",
    name: "Unit 01",
    longitude: -71.092,
    latitude: 42.36,
    accuracyMeters: 12,
    speedKmh: 0,
    headingDegrees: 90,
    fixedAt: "2026-09-20T11:59:58.000Z",
    ...overrides,
  };
}

describe("reading a published position", () => {
  it("accepts a well-formed fix", () => {
    expect(parsePositionSubmission(body())).toEqual({
      sourceId: "unit-01",
      name: "Unit 01",
      longitude: -71.092,
      latitude: 42.36,
      accuracyMeters: 12,
      speedKmh: 0,
      headingDegrees: 90,
      fixedAt: "2026-09-20T11:59:58.000Z",
    });
  });

  it("refuses a source id the frame store could not also hold", () => {
    expect(parsePositionSubmission(body({ sourceId: "unit 01" }))).toBeNull();
    expect(parsePositionSubmission(body({ sourceId: "" }))).toBeNull();
  });

  it("refuses coordinates that are not on the globe", () => {
    expect(parsePositionSubmission(body({ latitude: 91 }))).toBeNull();
    expect(parsePositionSubmission(body({ longitude: -181 }))).toBeNull();
    expect(parsePositionSubmission(body({ latitude: "42.36" }))).toBeNull();
  });

  it("refuses the null island a device reports before it has ever had a fix", () => {
    expect(parsePositionSubmission(body({ latitude: 0, longitude: 0 }))).toBeNull();
  });

  it("refuses a fix with no usable device time", () => {
    expect(parsePositionSubmission(body({ fixedAt: "not a date" }))).toBeNull();
    expect(parsePositionSubmission(body({ fixedAt: null }))).toBeNull();
  });

  it("drops values it cannot trust rather than passing them through", () => {
    const parsed = parsePositionSubmission(
      body({ accuracyMeters: -3, speedKmh: -1, headingDegrees: 400 }),
    );
    expect(parsed).toMatchObject({
      accuracyMeters: null,
      speedKmh: null,
      headingDegrees: null,
    });
  });

  it("falls back to the source id when no display name was sent", () => {
    expect(parsePositionSubmission(body({ name: "   " }))?.name).toBe("unit-01");
  });
});

describe("freshness", () => {
  it("ages a fix by when the server received it, not by the device clock", () => {
    // A phone an hour behind must not make a fix that just arrived look lost.
    const device = toLiveDevice(stored({ fixedAt: "2026-09-20T11:00:00.000Z" }), NOW);
    expect(device.fix?.ageSeconds).toBe(0);
    expect(device.fix?.freshness).toBe("live");
    // The device's own reading is still what a viewer is shown.
    expect(device.fix?.fixedAt).toBe("2026-09-20T11:00:00.000Z");
  });

  it("never reports a negative age when the clock steps backwards", () => {
    const device = toLiveDevice(stored({ publishedAt: "2026-09-20T12:00:30.000Z" }), NOW);
    expect(device.fix?.ageSeconds).toBe(0);
  });

  it("grades a position the way the map colours it", () => {
    const live = toLiveDevice(stored(), NOW);
    const stale = toLiveDevice(stored({ publishedAt: new Date(NOW - 120_000).toISOString() }), NOW);
    const lost = toLiveDevice(stored({ publishedAt: new Date(NOW - 900_000).toISOString() }), NOW);

    expect(live.fix?.freshness).toBe("live");
    expect(stale.fix?.freshness).toBe("stale");
    expect(lost.fix?.freshness).toBe("lost");
  });

  it("calls a unit online only while its fix is still live", () => {
    expect(toLiveDevice(stored(), NOW).online).toBe(true);
    expect(
      toLiveDevice(stored({ publishedAt: new Date(NOW - 300_000).toISOString() }), NOW).online,
    ).toBe(false);
  });

  it("names the unit by its id so a roster and a marker agree", () => {
    expect(toLiveDevice(stored(), NOW)).toMatchObject({ id: "unit-01", name: "Unit 01" });
  });
});

describe("holding the latest fix per unit", () => {
  it("replaces this unit's fix and leaves the others alone", () => {
    const merged = mergePosition(
      [stored({ sourceId: "unit-01", latitude: 42.1 }), stored({ sourceId: "unit-02" })],
      stored({ sourceId: "unit-01", latitude: 42.9 }),
    );

    expect(merged).toHaveLength(2);
    expect(merged.find((p) => p.sourceId === "unit-01")?.latitude).toBe(42.9);
    expect(merged.find((p) => p.sourceId === "unit-02")).toBeDefined();
  });

  it("bounds how many units one wall will carry", () => {
    const many = Array.from({ length: MAX_SOURCES + 4 }, (_, index) =>
      stored({ sourceId: `unit-${String(index).padStart(2, "0")}` }),
    );
    expect(mergePosition(many, stored({ sourceId: "unit-99" }))).toHaveLength(MAX_SOURCES);
  });

  it("drops a fix old enough to belong to a previous run", () => {
    const fresh = stored({ sourceId: "unit-01" });
    const ancient = stored({
      sourceId: "unit-02",
      publishedAt: new Date(NOW - DROP_AFTER_MS - 1000).toISOString(),
    });

    expect(activePositions([fresh, ancient], NOW).map((p) => p.sourceId)).toEqual(["unit-01"]);
  });

  it("keeps a fix that is merely stale, because last seen is still worth showing", () => {
    const stale = stored({ publishedAt: new Date(NOW - 300_000).toISOString() });
    expect(activePositions([stale], NOW)).toHaveLength(1);
  });
});

describe("stamping a fix", () => {
  it("records the server clock rather than trusting the phone's", () => {
    expect(storePosition(submission(), new Date(NOW)).publishedAt).toBe("2026-09-20T12:00:00.000Z");
  });
});
