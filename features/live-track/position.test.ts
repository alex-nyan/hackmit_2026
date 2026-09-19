import { describe, expect, it } from "vitest";

import { accuracyRing, classifyFreshness, knotsToKmh, newestFix, toLiveFix } from "./position";
import type { LiveFix } from "./types";

const NOW = new Date("2026-09-19T20:30:00.000Z");

function traccarPosition(overrides: Record<string, unknown> = {}) {
  return {
    deviceId: 1,
    valid: true,
    latitude: 42.35849,
    longitude: -71.09692,
    accuracy: 9.6,
    speed: 0,
    course: 0,
    fixTime: "2026-09-19T20:29:30.000Z",
    serverTime: "2026-09-19T20:33:23.000Z",
    ...overrides,
  };
}

describe("position boundary", () => {
  it("converts Traccar knots to km/h", () => {
    expect(knotsToKmh(1)).toBeCloseTo(1.852, 5);
    expect(knotsToKmh(0)).toBe(0);
  });

  it("ages the fix from the device clock, not the server clock", () => {
    // serverTime is three minutes later; only fixTime may drive the age.
    const fix = toLiveFix(traccarPosition(), NOW);
    expect(fix?.ageSeconds).toBe(30);
    expect(fix?.freshness).toBe("live");
  });

  it("falls back to deviceTime when fixTime is absent", () => {
    const raw = traccarPosition();
    delete (raw as Record<string, unknown>).fixTime;
    const fix = toLiveFix({ ...raw, deviceTime: "2026-09-19T20:29:00.000Z" }, NOW);
    expect(fix?.ageSeconds).toBe(60);
  });

  it("classifies freshness by age", () => {
    expect(classifyFreshness(0)).toBe("live");
    expect(classifyFreshness(90)).toBe("live");
    expect(classifyFreshness(91)).toBe("stale");
    expect(classifyFreshness(600)).toBe("stale");
    expect(classifyFreshness(601)).toBe("lost");
  });

  it("never reports a negative age when the device clock runs ahead", () => {
    const fix = toLiveFix(traccarPosition({ fixTime: "2026-09-19T20:31:00.000Z" }), NOW);
    expect(fix?.ageSeconds).toBe(0);
  });

  it("rejects records that are not usable positions", () => {
    expect(toLiveFix(null, NOW)).toBeNull();
    expect(toLiveFix("nope", NOW)).toBeNull();
    expect(toLiveFix(traccarPosition({ valid: false }), NOW)).toBeNull();
    expect(toLiveFix(traccarPosition({ latitude: "42" }), NOW)).toBeNull();
    expect(toLiveFix(traccarPosition({ latitude: 91 }), NOW)).toBeNull();
    expect(toLiveFix(traccarPosition({ longitude: 181 }), NOW)).toBeNull();
    expect(toLiveFix(traccarPosition({ latitude: NaN }), NOW)).toBeNull();
    expect(toLiveFix(traccarPosition({ fixTime: "not a date" }), NOW)).toBeNull();
  });

  it("rejects the null island placeholder from a device with no fix", () => {
    expect(toLiveFix(traccarPosition({ latitude: 0, longitude: 0 }), NOW)).toBeNull();
  });

  it("nulls unusable accuracy, speed and heading rather than inventing them", () => {
    const fix = toLiveFix(traccarPosition({ accuracy: -1, speed: -3, course: 400 }), NOW);
    expect(fix?.accuracyMeters).toBeNull();
    expect(fix?.speedKmh).toBeNull();
    expect(fix?.headingDegrees).toBeNull();
  });

  it("picks the newest fix by device time even when ids arrive out of order", () => {
    // Reproduces buffered delivery: the later-inserted row is the older fix.
    const older = toLiveFix(traccarPosition({ fixTime: "2026-09-19T20:06:31.000Z" }), NOW);
    const newer = toLiveFix(traccarPosition({ fixTime: "2026-09-19T20:11:32.000Z" }), NOW);
    expect(newestFix([newer!, older!])?.fixedAt).toBe("2026-09-19T20:11:32.000Z");
    expect(newestFix([older!, newer!])?.fixedAt).toBe("2026-09-19T20:11:32.000Z");
  });

  it("returns null when there is no fix to choose", () => {
    expect(newestFix([])).toBeNull();
  });
});

describe("accuracy ring", () => {
  it("closes the ring", () => {
    const ring = accuracyRing(-71.09692, 42.35849, 10, 16);
    expect(ring).toHaveLength(17);
    expect(ring[0]).toEqual(ring[16]);
  });

  it("spans roughly twice the radius across, in both axes", () => {
    const radius = 50;
    const latitude = 42.35849;
    const ring = accuracyRing(-71.09692, latitude, radius, 180);
    const lats = ring.map(([, lat]) => lat);
    const lons = ring.map(([lon]) => lon);

    const metresPerDegreeLat = 111320;
    const heightM = (Math.max(...lats) - Math.min(...lats)) * metresPerDegreeLat;
    const widthM =
      (Math.max(...lons) - Math.min(...lons)) *
      metresPerDegreeLat *
      Math.cos((latitude * Math.PI) / 180);

    expect(heightM).toBeGreaterThan(radius * 1.9);
    expect(heightM).toBeLessThan(radius * 2.1);
    expect(widthM).toBeGreaterThan(radius * 1.9);
    expect(widthM).toBeLessThan(radius * 2.1);
  });
});

describe("live fix shape", () => {
  it("exposes only viewer-facing fields", () => {
    const fix = toLiveFix(traccarPosition(), NOW) as LiveFix;
    expect(Object.keys(fix).sort()).toEqual(
      [
        "accuracyMeters",
        "ageSeconds",
        "fixedAt",
        "freshness",
        "headingDegrees",
        "latitude",
        "longitude",
        "speedKmh",
      ].sort(),
    );
  });
});
