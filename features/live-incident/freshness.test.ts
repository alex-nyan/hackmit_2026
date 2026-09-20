import { describe, expect, it } from "vitest";
import { effectiveFreshness } from "./freshness";

describe("live freshness between snapshots", () => {
  const value = { freshness: "fresh" as const, freshness_expires_at: "2026-09-20T00:00:03Z" };
  it("expires a camera observation before the next five-second poll", () => {
    expect(effectiveFreshness(value, true, Date.parse("2026-09-20T00:00:02Z"))).toBe("fresh");
    expect(effectiveFreshness(value, true, Date.parse("2026-09-20T00:00:03Z"))).toBe("stale");
  });
  it("cannot restore stale/historical evidence with a later expiry", () => {
    expect(effectiveFreshness({ ...value, freshness: "stale" }, true, 0)).toBe("stale");
    expect(effectiveFreshness({ ...value, freshness: "historical" }, true, 0)).toBe("historical");
    expect(effectiveFreshness(value, false, 0)).toBe("stale");
    expect(effectiveFreshness({ ...value, freshness_expires_at: null }, true, 0)).toBe("stale");
  });
});
