import { describe, expect, it } from "vitest";
import {
  PEOPLE,
  EVENTS,
  phaseAt,
  positionAt,
  personStatus,
  nextTime,
  clampTime,
  stamp,
  sampleHeartRate,
} from "./scenario";
import { demoReducer, initialDemo } from "./useScenario";
import { vehicleAt } from "./vehicles/vehicleMotion";
import { sceneAt, emsStatus } from "./consult";
describe("patrol-only demo", () => {
  it("never generates an incident, dispatch, injury or handoff from elapsed time", () => {
    expect(PEOPLE).toHaveLength(15);
    expect(EVENTS).toEqual([]);
    let state = demoReducer(initialDemo, { type: "play" });
    for (const delta of [15, 15, 15, 7, 4, 4, 15, 15, 3600]) {
      state = demoReducer(state, { type: "tick", delta });
      expect(state.running).toBe(true);
      expect(state.panics).toEqual([]);
      expect(state.audit).toEqual([]);
      expect(state.sceneOverride).toBeNull();
      expect(phaseAt(state.time)).toBe(0);
      expect(sceneAt(state.time, null).status).toBe("unknown");
      expect(emsStatus(state.time, "unknown")).toBe("Not requested");
      for (const person of PEOPLE) {
        expect(personStatus(person.id, state.time)).toBe("On patrol");
        expect(positionAt(person, state.time)).toEqual(vehicleAt(person.id, state.time).point);
        expect(sampleHeartRate(person.id, state.time)).toBe(sampleHeartRate(person.id, 0));
      }
    }
  });
  it("pauses, resumes and resets without stale ticks or a 90-second stop", () => {
    let state = demoReducer(initialDemo, { type: "play" });
    state = demoReducer(state, { type: "tick", delta: 1000 });
    expect(state).toMatchObject({ time: 1000, running: true });
    state = demoReducer(state, { type: "pause" });
    expect(demoReducer(state, { type: "tick", delta: 5 })).toEqual(state);
    state = demoReducer(state, { type: "play" });
    expect(state.time).toBe(1000);
    expect(demoReducer(state, { type: "reset" })).toEqual(initialDemo);
  });
  it("validates elapsed time and seeks forward without triggering stages", () => {
    expect(clampTime(NaN)).toBe(0);
    expect(clampTime(-5)).toBe(0);
    expect(clampTime(200)).toBe(200);
    expect(stamp(3601)).toBe("60:01");
    expect(nextTime(90)).toBe(105);
    expect(demoReducer(initialDemo, { type: "next" })).toEqual({ ...initialDemo, time: 15 });
  });
});
