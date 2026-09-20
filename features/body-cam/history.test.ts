import { describe, expect, it } from "vitest";

import { atFromHistoryPath, historyPath, historyPrefix } from "./frames";

describe("naming a frame in the archive", () => {
  it("keeps each officer's footage under its own prefix", () => {
    expect(historyPrefix("unit-02")).toBe("history/unit-02/");
    expect(historyPath("unit-02", 1789819200000)).toBe("history/unit-02/1789819200000.jpg");
  });

  it("pads the timestamp so the store's order is time's order", () => {
    const early = historyPath("unit-01", 999);
    const late = historyPath("unit-01", 1789819200000);
    expect(early < late).toBe(true);
    expect(early).toBe("history/unit-01/0000000000999.jpg");
  });

  it("round-trips the moment back out of the path", () => {
    expect(atFromHistoryPath(historyPath("unit-02", 1789819200000), "unit-02")).toBe(1789819200000);
  });

  it("refuses a path belonging to another officer or another shape", () => {
    expect(atFromHistoryPath("history/unit-01/1789819200000.jpg", "unit-02")).toBeNull();
    expect(atFromHistoryPath("frames/unit-02.jpg", "unit-02")).toBeNull();
    expect(atFromHistoryPath("history/unit-02/latest.jpg", "unit-02")).toBeNull();
    expect(atFromHistoryPath("history/unit-02/0.jpg", "unit-02")).toBeNull();
  });
});
