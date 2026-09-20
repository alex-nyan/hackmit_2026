import { describe, expect, it } from "vitest";
import {
  PEOPLE,
  EVENTS,
  phaseAt,
  positionAt,
  sampleHeartRate,
  personStatus,
  nextTime,
  clampTime,
  stamp,
  INCIDENT,
  DESTINATION,
} from "./scenario";
import { demoReducer, initialDemo } from "./useScenario";
import { distanceMeters, vehicleAt } from "./vehicles/vehicleMotion";
describe("deterministic demo", () => {
  it("advances only at known phase boundaries", () => {
    expect([0, 14.99, 15, 30, 45, 60, 75, 90].map(phaseAt)).toEqual([0, 0, 1, 2, 3, 4, 5, 5]);
  });
  it("never leaks injury or heart rate changes to another officer", () => {
    expect(personStatus("P-02", 45)).toBe("At scene");
    expect(personStatus("P-04", 45)).toBe("On patrol");
    expect(sampleHeartRate("P-02", 0)).toBe(sampleHeartRate("P-02", 90));
  });
  it("places responders at distinct nearby street stops and the patient at the receiving point", () => {
    expect(positionAt(PEOPLE[1], 45)).not.toEqual(INCIDENT);
    expect(distanceMeters(positionAt(PEOPLE[1], 45), INCIDENT)).toBeLessThan(25);
    expect(positionAt(PEOPLE[1], 45)).not.toEqual(positionAt(PEOPLE[2], 45));
    expect(positionAt(PEOPLE[0], 90)).toEqual(DESTINATION);
  });
  it("uses the same source of truth for vehicle and officer coordinates", () => {
    for (const person of PEOPLE)
      for (const time of [0, 14.9, 15, 30, 44.9, 45, 59, 60, 75, 90])
        expect(positionAt(person, time)).toEqual(vehicleAt(person.id, time).point);
  });
  it("keeps times safe and bounded", () => {
    expect(clampTime(NaN)).toBe(0);
    expect(clampTime(-5)).toBe(0);
    expect(clampTime(200)).toBe(90);
    expect(stamp(90)).toBe("01:30");
    expect(nextTime(90)).toBe(90);
  });
  it("has unique ordered events with explicit injury after the signal", () => {
    expect(new Set(EVENTS.map((e) => e.at)).size).toBe(EVENTS.length);
    expect(EVENTS.find((e) => e.title.includes("injury"))?.at).toBe(45);
  });
  it("pauses, resumes, clamps and resets without stale tick changes", () => {
    let s = demoReducer(initialDemo, { type: "play" });
    s = demoReducer(s, { type: "tick", delta: 45 });
    expect(s.time).toBe(45);
    s = demoReducer(s, { type: "pause" });
    expect(demoReducer(s, { type: "tick", delta: 5 })).toEqual(s);
    s = demoReducer(s, { type: "reset" });
    expect(demoReducer(s, { type: "tick", delta: 5 })).toEqual(initialDemo);
    s = demoReducer(s, { type: "play" });
    expect(demoReducer(s, { type: "tick", delta: 100 })).toEqual({
      ...initialDemo,
      time: 90,
      running: false,
    });
  });
  it("skips safely while preserving play state and ends stopped", () => {
    expect(demoReducer(initialDemo, { type: "next" })).toEqual({
      ...initialDemo,
      time: 15,
      running: false,
    });
    expect(demoReducer({ ...initialDemo, time: 75, running: true }, { type: "next" })).toEqual({
      ...initialDemo,
      time: 90,
      running: false,
    });
  });
});
