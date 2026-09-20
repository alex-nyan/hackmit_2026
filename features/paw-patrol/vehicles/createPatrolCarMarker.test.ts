import { describe, expect, it } from "vitest";
import { createPatrolCarMarker, patrolCarScreenHeading } from "./createPatrolCarMarker";

const origin: [number, number] = [-71.092, 42.36];

function projection(bearing = 0, pitch = 0) {
  return {
    project(point: [number, number]) {
      const east = (point[0] - origin[0]) * 111320 * Math.cos((origin[1] * Math.PI) / 180);
      const north = (point[1] - origin[1]) * 111320;
      const radians = (bearing * Math.PI) / 180;
      return {
        x: east * Math.cos(radians) - north * Math.sin(radians),
        y:
          -(east * Math.sin(radians) + north * Math.cos(radians)) *
          Math.cos((pitch * Math.PI) / 180),
      };
    },
  };
}

describe("screen-sized patrol car artwork", () => {
  it("creates fixed-size decorative SVG cars without focus targets or external assets", () => {
    const element = createPatrolCarMarker();
    const car = element.querySelector("svg");
    expect(element.getAttribute("aria-hidden")).toBe("true");
    expect(car?.getAttribute("width")).toBe("32");
    expect(car?.getAttribute("height")).toBe("44");
    expect(car?.getAttribute("viewBox")).toBe("0 0 64 88");
    expect(car?.getAttribute("focusable")).toBe("false");
    expect(element.querySelectorAll("[tabindex], button, a, image, use")).toHaveLength(0);
    expect(element.querySelector("[data-car-outline]")).not.toBeNull();
    expect(createPatrolCarMarker()).not.toBe(element);
  });

  it("creates the same neutral artwork without inheriting a unit colour", () => {
    const first = createPatrolCarMarker();
    const second = createPatrolCarMarker();
    expect(first.outerHTML).not.toMatch(/currentColor|--route-color|data-color/i);
    expect(second.innerHTML).toBe(first.innerHTML);
  });
});

describe("patrol car projected heading", () => {
  it.each([
    [0, 0],
    [45, 45],
    [90, 90],
    [270, -90],
  ])("faces heading %s on a flat north-up map", (heading, expected) => {
    expect(patrolCarScreenHeading(projection(), origin, heading)).toBeCloseTo(expected, 5);
  });

  it("accounts for map rotation independently from the geographic heading", () => {
    expect(patrolCarScreenHeading(projection(90), origin, 0)).toBeCloseTo(-90, 5);
    expect(patrolCarScreenHeading(projection(90), origin, 90)).toBeCloseTo(0, 5);
  });

  it("follows the projected street angle on a pitched map rather than just subtracting bearing", () => {
    const expected = (Math.atan2(1, 0.5) * 180) / Math.PI;
    expect(patrolCarScreenHeading(projection(0, 60), origin, 45)).toBeCloseTo(expected, 5);
    expect(patrolCarScreenHeading(projection(30, 60), origin, 75)).toBeCloseTo(expected, 5);
    expect(expected).not.toBeCloseTo(45);
  });

  it.each([
    { x: 10, y: 10 },
    { x: Number.NaN, y: 0 },
    { x: Number.POSITIVE_INFINITY, y: 0 },
  ])("uses a finite fallback for collapsed or invalid projections: %j", (screen) => {
    expect(patrolCarScreenHeading({ project: () => screen }, origin, 45)).toBe(0);
  });
});
