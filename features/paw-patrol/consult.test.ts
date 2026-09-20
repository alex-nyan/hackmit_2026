import { describe, expect, it } from "vitest";
import { bloodPressure, emptyMist, mistText, sceneAt, validateMist } from "./consult";
import { demoReducer, initialDemo } from "./useScenario";
import { INCIDENT, PEOPLE, positionAt, personStatus } from "./scenario";

describe("consult workflow safety", () => {
  it.each(["unsafe", "unknown"] as const)("holds EMS for %s even on oversized jumps", (status) => {
    let state = demoReducer({ ...initialDemo, time: 45, running: true }, { type: "scene", status });
    state = demoReducer(state, { type: "tick", delta: 100 });
    expect(state.time).toBe(59);
    expect(state.running).toBe(false);
    expect(positionAt(PEOPLE[0], state.time)).toEqual(INCIDENT);
    expect(demoReducer(state, { type: "next" }).time).toBe(59);
    state = demoReducer(state, { type: "scene", status: "cleared" });
    expect(demoReducer(state, { type: "next" }).time).toBe(60);
  });
  it("does not rewind or accept pre-incident clearance", () => {
    expect(demoReducer(initialDemo, { type: "scene", status: "cleared" })).toEqual(initialDemo);
    const state = demoReducer(
      { ...initialDemo, time: 59.75, running: true },
      { type: "scene", status: "unsafe" },
    );
    expect(demoReducer(state, { type: "tick", delta: 1 }).time).toBe(59.75);
  });
  it("uses a distinct scripted clearance in automatic playback", () => {
    expect(sceneAt(55, null).status).toBe("unsafe");
    expect(sceneAt(56, null)).toMatchObject({ status: "cleared", at: 56 });
    expect(demoReducer({ ...initialDemo, running: true }, { type: "tick", delta: 100 }).time).toBe(
      90,
    );
  });
  it("keeps panic person-specific, idempotent and distinct from injury", () => {
    const state = demoReducer(initialDemo, { type: "panic", personId: "P-02" });
    expect(state).toMatchObject({ time: 0, running: false, sceneOverride: { status: "unsafe" } });
    expect(state.panics).toHaveLength(1);
    expect(demoReducer(state, { type: "panic", personId: "P-02" })).toEqual(state);
    expect(demoReducer(state, { type: "panic", personId: "INVALID" })).toEqual(state);
    expect(personStatus("P-02", 45)).toBe("At scene");
    const acknowledged = demoReducer(state, { type: "acknowledge", personId: "P-02" });
    expect(acknowledged.panics[0].acknowledgedAt).toBe(0);
    expect(acknowledged.sceneOverride?.status).toBe("unsafe");
    expect(demoReducer(acknowledged, { type: "reset" })).toEqual(initialDemo);
    expect(demoReducer({ ...acknowledged, time: 90 }, { type: "play" })).toEqual({
      ...initialDemo,
      running: true,
    });
  });
  it.each([0, 5.25, 14.99, 15, 40])(
    "records panic at %s without advancing any patrol unit",
    (time) => {
      const before = PEOPLE.map((person) => positionAt(person, time));
      const state = demoReducer(
        { ...initialDemo, time, running: true },
        { type: "panic", personId: "P-02" },
      );
      expect(state).toMatchObject({
        time,
        running: false,
        sceneOverride: { status: "unsafe", at: time },
      });
      expect(state.panics[0].at).toBe(time);
      expect(state.audit[0].at).toBe(time);
      expect(PEOPLE.map((person) => positionAt(person, state.time))).toEqual(before);
    },
  );
  it("retains historical scene clearance once transport begins", () => {
    const state = { ...initialDemo, time: 60 };
    expect(demoReducer(state, { type: "scene", status: "unsafe" })).toEqual(state);
    expect(demoReducer(state, { type: "panic", personId: "P-01" })).toEqual(state);
  });
  it("never invents BP, pulse, or consciousness", () => {
    const record = emptyMist(45);
    expect(bloodPressure(record)).toBe("Not measured");
    expect(record.pulse).toBe("Not assessed");
    expect(record.consciousness).toBe("Not assessed");
    expect(validateMist({ ...record, bpMethod: "Cuff", systolic: "120" })).not.toBeNull();
    expect(
      validateMist({ ...record, bpMethod: "Cuff", systolic: "120", diastolic: "130" }),
    ).not.toBeNull();
    expect(validateMist({ ...record, bpMethod: "Palpated systolic", systolic: "110" })).toBeNull();
    expect(bloodPressure({ ...record, systolic: "120" })).toBe("Not measured");
    const text = mistText(PEOPLE[0], record, 100, 45, sceneAt(45, null));
    for (const label of [
      "M — Mechanism",
      "I — Injuries",
      "S — Signs",
      "T — Treatments",
      "synthetic",
      "No real patient data",
    ])
      expect(text).toContain(label);
  });
});
