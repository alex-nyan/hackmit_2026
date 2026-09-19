import { describe, expect, it } from "vitest";

import {
  describeBuilding,
  formatArea,
  formatHeight,
  polygonAreaM2,
  ringAreaM2,
} from "./buildingSelection";

const LAT = 42.3601;
const LON = -71.0921;
const METRES_PER_DEGREE_LAT = 111320;

/** A closed, counter-clockwise square of the requested size near MIT. */
function square(sideMetres: number): [number, number][] {
  const dLat = sideMetres / METRES_PER_DEGREE_LAT;
  const dLon = dLat / Math.cos((LAT * Math.PI) / 180);
  return [
    [LON, LAT],
    [LON + dLon, LAT],
    [LON + dLon, LAT + dLat],
    [LON, LAT + dLat],
    [LON, LAT],
  ];
}

describe("footprint area", () => {
  it("measures a 100 m square as about a hectare", () => {
    const area = Math.abs(ringAreaM2(square(100)));
    expect(area).toBeGreaterThan(9800);
    expect(area).toBeLessThan(10200);
  });

  it("gives the same magnitude regardless of winding direction", () => {
    const ring = square(100);
    const reversed = [...ring].reverse();
    expect(Math.abs(ringAreaM2(reversed))).toBeCloseTo(Math.abs(ringAreaM2(ring)), 2);
  });

  it("treats degenerate rings as no area", () => {
    expect(ringAreaM2([])).toBe(0);
    expect(ringAreaM2([[LON, LAT]])).toBe(0);
    expect(
      ringAreaM2([
        [LON, LAT],
        [LON, LAT],
      ]),
    ).toBe(0);
  });

  it("subtracts holes from the outline", () => {
    const outer = square(100);
    const inner = square(50);
    const solid = polygonAreaM2({ type: "Polygon", coordinates: [outer] })!;
    const holed = polygonAreaM2({ type: "Polygon", coordinates: [outer, inner] })!;
    expect(holed).toBeLessThan(solid);
    expect(solid - holed).toBeGreaterThan(2300);
    expect(solid - holed).toBeLessThan(2700);
  });

  it("sums the parts of a MultiPolygon", () => {
    const one = polygonAreaM2({ type: "Polygon", coordinates: [square(100)] })!;
    const two = polygonAreaM2({
      type: "MultiPolygon",
      coordinates: [[square(100)], [square(100)]],
    })!;
    expect(two).toBeCloseTo(one * 2, 0);
  });

  it("returns null for geometry it cannot measure", () => {
    expect(polygonAreaM2(null)).toBeNull();
    expect(polygonAreaM2({ type: "Point", coordinates: [LON, LAT] })).toBeNull();
    expect(polygonAreaM2({ type: "Polygon", coordinates: [] })).toBeNull();
  });
});

describe("describing a clicked building", () => {
  const footprint = { type: "Polygon", coordinates: [square(30)] };

  function feature(properties: Record<string, unknown>) {
    return { id: 42, properties, geometry: footprint };
  }

  it("reads the real height and base carried by the tile", () => {
    const facts = describeBuilding(feature({ height: 27.5, min_height: 4 }));
    expect(facts).toMatchObject({ heightM: 27.5, baseM: 4, id: 42 });
    expect(facts?.footprintM2).toBeGreaterThan(800);
  });

  it("reports a missing height rather than guessing one", () => {
    expect(describeBuilding(feature({}))?.heightM).toBeNull();
    expect(describeBuilding(feature({ height: "tall" }))?.heightM).toBeNull();
    expect(describeBuilding(feature({ height: Number.NaN }))?.heightM).toBeNull();
  });

  it("treats a zero base as no base, since ground level is the default", () => {
    expect(describeBuilding(feature({ height: 10, min_height: 0 }))?.baseM).toBeNull();
  });

  it("keeps a null id when the tile carries none, so selection can be skipped", () => {
    // A feature with no id at all, as some tiles produce.
    const withoutId = { properties: { height: 10 }, geometry: footprint };
    expect(describeBuilding(withoutId)?.id).toBeNull();
    expect(describeBuilding(withoutId)?.heightM).toBe(10);
  });

  it("rejects values that are not features", () => {
    expect(describeBuilding(null)).toBeNull();
    expect(describeBuilding("building")).toBeNull();
  });
});

describe("formatting", () => {
  it("says what is missing instead of printing a zero", () => {
    expect(formatHeight(null)).toBe("not recorded");
    expect(formatArea(null)).toBe("not recorded");
  });

  it("keeps a decimal only where it carries information", () => {
    expect(formatHeight(4.25)).toBe("4.3 m");
    expect(formatHeight(27.5)).toBe("28 m");
  });

  it("groups large footprints", () => {
    expect(formatArea(12345.6)).toBe("12,346 m²");
  });
});
