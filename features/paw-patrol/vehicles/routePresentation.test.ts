import { describe, expect, it } from "vitest";
import { routeChevrons } from "./routePresentation";
import type { VehiclePoint, VehicleRoute } from "./vehicleMotion";

function route(coordinates: VehiclePoint[]): VehicleRoute {
  return {
    id: "test",
    unitId: "P-01",
    kind: "patrol",
    startTime: 0,
    endTime: 90,
    coordinates,
    roadNames: [],
  };
}

describe("route direction chevrons", () => {
  it.each([
    { end: [-71, 42.01] as VehiclePoint, axis: 1, sign: 1 },
    { end: [-70.99, 42] as VehiclePoint, axis: 0, sign: 1 },
    { end: [-71, 41.99] as VehiclePoint, axis: 1, sign: -1 },
    { end: [-71.01, 42] as VehiclePoint, axis: 0, sign: -1 },
  ])("points in the direction of travel toward $end", ({ end, axis, sign }) => {
    const data = routeChevrons(
      [{ route: route([[-71, 42], end]), color: "blue", selected: true }],
      17,
    );
    expect(data.features.length).toBeGreaterThan(0);
    for (const feature of data.features) {
      if (feature.geometry.type !== "LineString") throw new Error("Expected line");
      const [left, tip, right] = feature.geometry.coordinates;
      expect((tip[axis] - (left[axis] + right[axis]) / 2) * sign).toBeGreaterThan(0);
    }
  });

  it("limits arrow density and skips zero-length paths", () => {
    const routes = [
      {
        route: route([
          [-71, 42],
          [-70, 42],
        ]),
        color: "blue",
        selected: false,
      },
    ];
    expect(routeChevrons(routes, 22).features.length).toBeLessThanOrEqual(100);
    expect(routeChevrons(routes, 12).features.length).toBeLessThan(
      routeChevrons(routes, 22).features.length,
    );
    expect(
      routeChevrons(
        [
          {
            ...routes[0],
            route: route([
              [-71, 42],
              [-71, 42],
            ]),
          },
        ],
        17,
      ).features,
    ).toEqual([]);
  });
});
