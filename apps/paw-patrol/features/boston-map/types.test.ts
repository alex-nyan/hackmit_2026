import { describe, expect, it } from "vitest";

import { MAP_FOCUS } from "./types";

describe("Boston map focus points", () => {
  it("keeps every focus point inside Greater Boston", () => {
    Object.values(MAP_FOCUS).forEach(({ center: [longitude, latitude] }) => {
      expect(longitude).toBeGreaterThan(-71.25);
      expect(longitude).toBeLessThan(-70.95);
      expect(latitude).toBeGreaterThan(42.25);
      expect(latitude).toBeLessThan(42.45);
    });
  });

  it("uses a unique label for each focus option", () => {
    const labels = Object.values(MAP_FOCUS).map(({ label }) => label);
    expect(new Set(labels).size).toBe(labels.length);
  });
});
