import { describe, expect, it } from "vitest";
import {
  PATROL_UNITS,
  VEHICLE_ROUTES,
  bearingDegrees,
  distanceMeters,
  headingAtDistance,
  motionAtElapsed,
  parseVehicleRoutes,
  pointAtDistance,
  prepareRouteGeometry,
  vehicleAt,
  vehicleRoute,
  type VehiclePoint,
} from "./vehicleMotion";

describe("distance-based road sampling", () => {
  it("weights progress by distance, not the number of road vertices", () => {
    const route = prepareRouteGeometry([
      [0, 0],
      [0.001, 0],
      [0.01, 0],
    ]);
    expect(pointAtDistance(route, route.lengthMeters / 2)[0]).toBeCloseTo(0.005, 7);
    expect(pointAtDistance(route, route.lengthMeters / 2)[1]).toBe(0);
  });

  it("stays on road segments through a right-angle turn instead of cutting the corner", () => {
    const route = prepareRouteGeometry([
      [0, 0],
      [0.001, 0],
      [0.001, 0.001],
    ]);
    const corner = route.cumulativeMeters[1];
    expect(pointAtDistance(route, corner - 2)[1]).toBe(0);
    expect(pointAtDistance(route, corner + 2)[0]).toBe(0.001);
    expect(headingAtDistance(route, corner)).toBeCloseTo(45, 2);
    expect(headingAtDistance(route, corner - 0.01)).toBeGreaterThan(
      headingAtDistance(route, corner + 0.01),
    );
  });

  it("reports bearings clockwise from north, including wrap-around", () => {
    expect(bearingDegrees([0, 0], [0, 1])).toBe(0);
    expect(bearingDegrees([0, 0], [1, 0])).toBe(90);
    expect(bearingDegrees([0, 0], [0, -1])).toBe(180);
    expect(bearingDegrees([0, 0], [-1, 0])).toBe(270);
    expect(bearingDegrees([0, 0], [0, 0])).toBe(0);
  });

  it("handles empty, single-point, duplicate, non-finite and out-of-bounds inputs", () => {
    for (const points of [
      [],
      [[1, 2]],
      [
        [1, 2],
        [1, 2],
      ],
    ] as VehiclePoint[][]) {
      const route = prepareRouteGeometry(points);
      for (const meters of [NaN, -1, 0, Infinity, 100]) {
        expect(pointAtDistance(route, meters).every(Number.isFinite)).toBe(true);
        expect(headingAtDistance(route, meters)).toBe(0);
      }
    }
    expect(
      prepareRouteGeometry([
        [0, 0],
        [NaN, 1],
        [1, 1],
      ]).coordinates,
    ).toEqual([]);
    expect(prepareRouteGeometry([[181, 0]]).coordinates).toEqual([]);
    const route = prepareRouteGeometry([
      [0, 0],
      [0.01, 0],
    ]);
    expect(pointAtDistance(route, -100)).toEqual([0, 0]);
    expect(pointAtDistance(route, 1e9)).toEqual([0.01, 0]);
  });

  it("rejects corrupt route definitions without creating a bridge over missing geometry", () => {
    const valid = {
      id: "test",
      unitId: "P-01",
      kind: "patrol",
      startTime: 0,
      endTime: 10,
      coordinates: [
        [0, 0],
        [0.001, 0],
      ],
      roadNames: ["Test Road"],
    };
    expect(parseVehicleRoutes(null)).toEqual([]);
    expect(parseVehicleRoutes([valid, valid])).toHaveLength(1);
    expect(
      parseVehicleRoutes([
        {
          ...valid,
          coordinates: [
            [0, 0],
            [NaN, 0],
            [1, 1],
          ],
        },
      ]),
    ).toEqual([]);
    expect(
      parseVehicleRoutes([
        { ...valid, endTime: 0 },
        { ...valid, startTime: NaN },
        { ...valid, kind: "fly" },
        { ...valid, coordinates: [] },
      ]),
    ).toEqual([]);
  });

  it("accelerates and decelerates without changing road-distance progress", () => {
    expect(motionAtElapsed(100, 12, 0)).toEqual({ distance: 0, speedMps: 0 });
    expect(motionAtElapsed(100, 12, 1)).toEqual({ distance: 2.5, speedMps: 5 });
    expect(motionAtElapsed(100, 12, 6)).toEqual({ distance: 50, speedMps: 10 });
    expect(motionAtElapsed(100, 12, 11)).toEqual({ distance: 97.5, speedMps: 5 });
    expect(motionAtElapsed(100, 12, 15)).toEqual({ distance: 100, speedMps: 0 });
    expect(motionAtElapsed(NaN, 12, 1)).toEqual({ distance: 0, speedMps: 0 });
    expect(motionAtElapsed(100, 0, 1)).toEqual({ distance: 0, speedMps: 0 });
  });
});

describe("continuous Boston patrol", () => {
  it("has fifteen patrol units on closed road loops", () => {
    expect(VEHICLE_ROUTES).toHaveLength(15);
    expect(new Set(VEHICLE_ROUTES.map((r) => r.unitId)).size).toBe(15);
    for (const route of VEHICLE_ROUTES) {
      expect(route.kind).toBe("patrol");
      expect(route.coordinates.length).toBeGreaterThan(100);
      expect(route.coordinates.at(-1)).toEqual(route.coordinates[0]);
    }
    expect(vehicleRoute("P-99", 10)).toBeNull();
    expect(vehicleAt("P-99", 10)).toMatchObject({ speedMps: 0, routeId: "", emergency: false });
  });
  it("keeps all cars moving at plausible speeds without emergency lights after the former ending", () => {
    for (const time of [0, 15, 30, 45, 60, 75, 90, 600, 3600, 86400]) {
      const samples = PATROL_UNITS.map(({ id }) => vehicleAt(id, time));
      expect(new Set(samples.map(({ point }) => point.join(","))).size).toBe(15);
      for (const sample of samples) {
        expect(sample.speedMps).toBeGreaterThan(0);
        expect(sample.speedMps).toBeLessThan(12);
        expect(sample.emergency).toBe(false);
        expect(sample.heading).toBeGreaterThanOrEqual(0);
        expect(sample.heading).toBeLessThan(360);
        expect(sample.point.every(Number.isFinite)).toBe(true);
      }
      for (const { id } of PATROL_UNITS)
        expect(vehicleAt(id, time + 1).point).not.toEqual(vehicleAt(id, time).point);
    }
  });
  it("crosses lap boundaries without teleporting or snapping its heading", () => {
    for (const unit of PATROL_UNITS) {
      const lap = unit.geometry.lengthMeters / unit.speedMps;
      const seam = (unit.geometry.lengthMeters - unit.offsetMeters) / unit.speedMps;
      for (const time of [seam, seam + lap, seam + lap * 10]) {
        const before = vehicleAt(unit.id, time - 0.01);
        const after = vehicleAt(unit.id, time + 0.01);
        expect(distanceMeters(before.point, after.point)).toBeLessThan(0.25);
        const turn = Math.abs(((after.heading - before.heading + 540) % 360) - 180);
        expect(turn).toBeLessThan(10);
      }
      expect(
        distanceMeters(vehicleAt(unit.id, 0).point, vehicleAt(unit.id, lap).point),
      ).toBeLessThan(0.001);
    }
  });
  it("is deterministic and never mutates cached geometry", () => {
    const original = JSON.stringify(VEHICLE_ROUTES);
    for (const { id } of PATROL_UNITS) {
      const a = vehicleAt(id, 500);
      expect(vehicleAt(id, 500)).toEqual(a);
      a.point[0] = 0;
      expect(vehicleAt(id, 500).point[0]).not.toBe(0);
      expect(vehicleAt(id, NaN)).toEqual(vehicleAt(id, 0));
      expect(vehicleAt(id, -1)).toEqual(vehicleAt(id, 0));
    }
    expect(JSON.stringify(VEHICLE_ROUTES)).toBe(original);
  });
});
