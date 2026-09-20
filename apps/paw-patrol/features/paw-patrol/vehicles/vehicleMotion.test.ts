import { describe, expect, it } from "vitest";
import {
  DEMO_DESTINATION, DEMO_INCIDENT, VEHICLE_ROUTES, bearingDegrees, distanceMeters,
  headingAtDistance, motionAtElapsed, parseVehicleRoutes, pointAtDistance,
  prepareRouteGeometry, vehicleAt, vehicleRoute, type VehiclePoint,
} from "./vehicleMotion";

describe("distance-based road sampling", () => {
  it("weights progress by distance, not the number of road vertices", () => {
    const route = prepareRouteGeometry([[0, 0], [0.001, 0], [0.01, 0]]);
    expect(pointAtDistance(route, route.lengthMeters / 2)[0]).toBeCloseTo(0.005, 7);
    expect(pointAtDistance(route, route.lengthMeters / 2)[1]).toBe(0);
  });

  it("stays on road segments through a right-angle turn instead of cutting the corner", () => {
    const route = prepareRouteGeometry([[0, 0], [0.001, 0], [0.001, 0.001]]);
    const corner = route.cumulativeMeters[1];
    expect(pointAtDistance(route, corner - 2)[1]).toBe(0);
    expect(pointAtDistance(route, corner + 2)[0]).toBe(0.001);
    expect(headingAtDistance(route, corner)).toBeCloseTo(45, 2);
    expect(headingAtDistance(route, corner - 0.01)).toBeGreaterThan(headingAtDistance(route, corner + 0.01));
  });

  it("reports bearings clockwise from north, including wrap-around", () => {
    expect(bearingDegrees([0, 0], [0, 1])).toBe(0);
    expect(bearingDegrees([0, 0], [1, 0])).toBe(90);
    expect(bearingDegrees([0, 0], [0, -1])).toBe(180);
    expect(bearingDegrees([0, 0], [-1, 0])).toBe(270);
    expect(bearingDegrees([0, 0], [0, 0])).toBe(0);
  });

  it("handles empty, single-point, duplicate, non-finite and out-of-bounds inputs", () => {
    for (const points of [[], [[1, 2]], [[1, 2], [1, 2]]] as VehiclePoint[][]) {
      const route = prepareRouteGeometry(points);
      for (const meters of [NaN, -1, 0, Infinity, 100]) {
        expect(pointAtDistance(route, meters).every(Number.isFinite)).toBe(true);
        expect(headingAtDistance(route, meters)).toBe(0);
      }
    }
    expect(prepareRouteGeometry([[0, 0], [NaN, 1], [1, 1]]).coordinates).toEqual([]);
    expect(prepareRouteGeometry([[181, 0]]).coordinates).toEqual([]);
    const route = prepareRouteGeometry([[0, 0], [0.01, 0]]);
    expect(pointAtDistance(route, -100)).toEqual([0, 0]);
    expect(pointAtDistance(route, 1e9)).toEqual([0.01, 0]);
  });

  it("rejects corrupt route definitions without creating a bridge over missing geometry", () => {
    const valid = { id: "test", unitId: "P-01", kind: "patrol", startTime: 0, endTime: 10, coordinates: [[0, 0], [0.001, 0]], roadNames: ["Test Road"] };
    expect(parseVehicleRoutes(null)).toEqual([]);
    expect(parseVehicleRoutes([valid, valid])).toHaveLength(1);
    expect(parseVehicleRoutes([{ ...valid, coordinates: [[0, 0], [NaN, 0], [1, 1]] }])).toEqual([]);
    expect(parseVehicleRoutes([{ ...valid, endTime: 0 }, { ...valid, startTime: NaN }, { ...valid, kind: "fly" }, { ...valid, coordinates: [] }])).toEqual([]);
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

describe("shared patrol simulation", () => {
  it("loads seven deterministic road routes for the four real roster entries", () => {
    expect(VEHICLE_ROUTES).toHaveLength(7);
    expect(new Set(VEHICLE_ROUTES.map((route) => route.unitId))).toEqual(new Set(["P-01", "P-02", "P-03", "P-04"]));
    expect(vehicleRoute("P-99", 10)).toBeNull();
    expect(vehicleAt("P-99", 10)).toMatchObject({ speedMps: 0, emergency: false, routeId: "", roadName: "Route unavailable" });
  });

  it("holds before departure, between legs and after completion without looping or teleporting", () => {
    expect(vehicleAt("P-01", 15).point).toEqual(DEMO_INCIDENT);
    expect(vehicleAt("P-01", 59.99).point).toEqual(DEMO_INCIDENT);
    expect(vehicleAt("P-01", 60).point).toEqual(DEMO_INCIDENT);
    expect(vehicleAt("P-01", 90).point).toEqual(DEMO_DESTINATION);
    expect(vehicleAt("P-01", 900)).toEqual(vehicleAt("P-01", 90));
    expect(vehicleAt("P-01", NaN)).toEqual(vehicleAt("P-01", 0));
    expect(vehicleAt("P-01", -20)).toEqual(vehicleAt("P-01", 0));
    for (const id of ["P-02", "P-03"]) {
      expect(distanceMeters(vehicleAt(id, 29.999).point, vehicleAt(id, 30).point)).toBeLessThan(0.001);
      expect(vehicleAt(id, 45).point).toEqual(vehicleAt(id, 89).point);
      expect(vehicleAt(id, 45).speedMps).toBe(0);
    }
  });

  it("has distinct unit positions and plausible speeds across the whole demo", () => {
    for (let time = 0; time <= 90; time += 0.25) {
      const samples = ["P-01", "P-02", "P-03", "P-04"].map((id) => vehicleAt(id, time));
      expect(new Set(samples.map(({ point }) => point.join(","))).size).toBe(4);
      for (const sample of samples) {
        expect(sample.speedMps).toBeGreaterThanOrEqual(0);
        expect(sample.speedMps).toBeLessThan(16);
        expect(sample.heading).toBeGreaterThanOrEqual(0);
        expect(sample.heading).toBeLessThan(360);
        expect(sample.point.every(Number.isFinite)).toBe(true);
      }
    }
  });

  it("has bounded continuous positions at every route junction and incident boundary", () => {
    for (const id of ["P-01", "P-02", "P-03", "P-04"]) {
      let previous = vehicleAt(id, 0).point;
      for (let frame = 1; frame <= 900; frame++) {
        const point = vehicleAt(id, frame / 10).point;
        expect(distanceMeters(previous, point)).toBeLessThan(1.6);
        previous = point;
      }
    }
  });

  it("enables lights only during explicit incident response, not normal patrol or completion", () => {
    expect(vehicleAt("P-01", 14.99).emergency).toBe(false);
    expect(vehicleAt("P-01", 15).emergency).toBe(true);
    expect(vehicleAt("P-02", 29.99).emergency).toBe(false);
    expect(vehicleAt("P-02", 30).emergency).toBe(true);
    expect(vehicleAt("P-03", 45).emergency).toBe(true);
    for (const id of ["P-01", "P-02", "P-03", "P-04"]) expect(vehicleAt(id, 90).emergency).toBe(false);
    for (const time of [0, 15, 30, 60, 89]) expect(vehicleAt("P-04", time).emergency).toBe(false);
  });

  it("is pure: pause, repeated sampling and reset cannot mutate shared route coordinates", () => {
    const original = JSON.stringify(VEHICLE_ROUTES);
    const paused = vehicleAt("P-02", 35);
    expect(vehicleAt("P-02", 35)).toEqual(paused);
    paused.point[0] = 0;
    expect(vehicleAt("P-02", 35).point[0]).not.toBe(0);
    expect(vehicleAt("P-02", 0).point).toEqual(vehicleRoute("P-02", 0)?.coordinates[0]);
    expect(JSON.stringify(VEHICLE_ROUTES)).toBe(original);
  });
});
