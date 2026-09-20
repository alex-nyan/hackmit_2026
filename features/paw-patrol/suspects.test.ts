import { describe, expect, it } from "vitest";
import { SUSPECTS, reportedSuspects, suspectAt, suspectStatus } from "./suspects";
import { INCIDENT } from "./scenario";
import { distanceMeters } from "./vehicles/vehicleMotion";

const [S1] = SUSPECTS;

describe("reported persons of interest", () => {
  it("places nobody on the map before the report exists", () => {
    expect(reportedSuspects(S1.from - 0.1)).toEqual([]);
    expect(suspectAt(S1.id, 0)).toBeNull();
    expect(suspectAt(S1.id, S1.from - 0.1)).toBeNull();
    expect(reportedSuspects(S1.from)).toEqual([S1]);
  });

  it("starts at the scripted incident and leaves it on foot", () => {
    expect(suspectAt(S1.id, S1.from)?.point).toEqual([...S1.path[0]]);
    expect(distanceMeters(S1.path[0], INCIDENT)).toBeLessThan(1);
    const midway = suspectAt(S1.id, (S1.from + S1.until) / 2)!;
    expect(midway.moving).toBe(true);
    // A run, not a drive: the whole track is well under vehicle speed.
    expect(midway.speedMps).toBeLessThan(6);
    expect(distanceMeters(midway.point, INCIDENT)).toBeGreaterThan(20);
  });

  it("holds the last reported position instead of looping or vanishing", () => {
    const end = suspectAt(S1.id, S1.until)!;
    expect(end.point).toEqual([...S1.path.at(-1)!]);
    expect(end.moving).toBe(false);
    expect(suspectAt(S1.id, 90)?.point).toEqual(end.point);
    expect(suspectStatus(S1.id, S1.until - 1)).toBe(S1.movingLabel);
    expect(suspectStatus(S1.id, 90)).toBe(S1.holdingLabel);
  });

  it("keeps times bounded and unknown ids empty", () => {
    expect(suspectAt(S1.id, Number.NaN)).toBeNull();
    expect(suspectAt(S1.id, 1e9)?.point).toEqual([...S1.path.at(-1)!]);
    expect(suspectAt("nobody", 30)).toBeNull();
    expect(suspectStatus("nobody", 30)).toBe("");
    expect(reportedSuspects(Number.NaN)).toEqual([]);
  });

  it("gives every track a usable window and distinct identifier", () => {
    expect(new Set(SUSPECTS.map((s) => s.id)).size).toBe(SUSPECTS.length);
    for (const suspect of SUSPECTS) {
      expect(suspect.until).toBeGreaterThan(suspect.from);
      expect(suspect.path.length).toBeGreaterThan(1);
    }
  });
});
