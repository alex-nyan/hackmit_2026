import { afterEach, describe, expect, it } from "vitest";
import { Mesh, type MeshStandardMaterial } from "three";

import { createVehicleFleetResources, type PatrolCar } from "./createPatrolCar";

const fleets: ReturnType<typeof createVehicleFleetResources>[] = [];

function createCar() {
  const fleet = createVehicleFleetResources();
  fleets.push(fleet);
  return fleet.createCar();
}

function lampIntensities(car: PatrolCar) {
  return car.group.children
    .filter((object) => object.name === "Emergency light bar")
    .map((object) => {
      expect(object).toBeInstanceOf(Mesh);
      return ((object as Mesh).material as MeshStandardMaterial).emissiveIntensity;
    });
}

afterEach(() => {
  for (const fleet of fleets) fleet.dispose();
  fleets.length = 0;
});

describe("patrol vehicle motion accessibility", () => {
  it("never animates emergency lights without an explicit emergency", () => {
    const car = createCar();
    for (const reducedMotion of [false, true]) {
      for (const seconds of [0, 0.25, 0.5, 1.25, 10, 90]) {
        car.setEmergency(false, seconds, reducedMotion);
        expect(lampIntensities(car)).toEqual([0, 0]);
      }
    }
  });

  it("uses a steady emergency indication when reduced motion is requested", () => {
    const car = createCar();
    car.setEmergency(true, 0, true);
    const steady = lampIntensities(car);
    expect(steady).toHaveLength(2);
    expect(steady.every((intensity) => intensity > 0 && intensity < 1)).toBe(true);
    for (const seconds of [0.1, 0.5, 1, 5.25, 89.5]) {
      car.setEmergency(true, seconds, true);
      expect(lampIntensities(car)).toEqual(steady);
    }
    car.setEmergency(false, 90, true);
    expect(lampIntensities(car)).toEqual([0, 0]);
  });

  it("changes selection without triggering lights or pulsing its outline", () => {
    const car = createCar();
    const outline = car.group.getObjectByName("Selected unit outline");
    expect(outline?.visible).toBe(false);
    car.setSelected(true);
    expect(outline?.visible).toBe(true);
    for (const seconds of [0, 1, 30, 60, 90]) {
      car.setEmergency(false, seconds, true);
      expect(outline?.visible).toBe(true);
      expect(lampIntensities(car)).toEqual([0, 0]);
    }
    car.setSelected(false);
    expect(outline?.visible).toBe(false);
  });
});
