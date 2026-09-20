import { describe, expect, it } from "vitest";

import { findOfficer, parseRoster, publicOfficer, readRoster } from "./roster";
import { OFFICER_COOKIE, issueSession, readSession } from "./session";

const ROSTER = JSON.stringify([
  { id: "unit-01", name: "A. Nyan", badge: "4417", passcode: "1234" },
  { id: "unit-02", name: "B. Chen", badge: "5120", passcode: "5678" },
]);

describe("reading the roster", () => {
  it("accepts well-formed officers", () => {
    expect(parseRoster(ROSTER).map((o) => o.id)).toEqual(["unit-01", "unit-02"]);
  });

  it("is empty when none is configured", () => {
    expect(parseRoster(undefined)).toEqual([]);
    expect(parseRoster("   ")).toEqual([]);
    expect(parseRoster("not json")).toEqual([]);
    expect(parseRoster('{"id":"unit-01"}')).toEqual([]);
  });

  it("drops a malformed entry rather than the whole shift", () => {
    const mixed = JSON.stringify([
      { id: "unit-01", name: "A. Nyan", badge: "4417", passcode: "1234" },
      { id: "unit 02", name: "Bad Id", badge: "1", passcode: "1" },
      { id: "unit-03", name: "", badge: "1", passcode: "1" },
      { id: "unit-04", name: "No Passcode", badge: "1", passcode: "" },
    ]);
    expect(parseRoster(mixed).map((o) => o.id)).toEqual(["unit-01"]);
  });

  it("keeps the first of a duplicated id, so two entries cannot share one identity", () => {
    const duplicated = JSON.stringify([
      { id: "unit-01", name: "First", badge: "1", passcode: "1" },
      { id: "unit-01", name: "Second", badge: "2", passcode: "2" },
    ]);
    expect(parseRoster(duplicated).map((o) => o.name)).toEqual(["First"]);
  });

  it("never exposes a passcode to a browser", () => {
    const [entry] = parseRoster(ROSTER);
    expect(publicOfficer(entry)).toEqual({ id: "unit-01", name: "A. Nyan", badge: "4417" });
    expect(Object.keys(publicOfficer(entry))).not.toContain("passcode");
  });

  it("finds an officer by id and nobody by a wrong one", () => {
    const roster = readRoster({ PAW_PATROL_OFFICERS: ROSTER });
    expect(findOfficer(roster, "unit-02")?.name).toBe("B. Chen");
    expect(findOfficer(roster, "unit-09")).toBeNull();
  });
});

describe("the officer session", () => {
  it("round-trips the officer it was issued for", async () => {
    const cookie = await issueSession("unit-01", ROSTER);
    expect(await readSession(cookie, ROSTER)).toBe("unit-01");
  });

  it("refuses a cookie somebody wrote themselves", async () => {
    expect(await readSession("unit-01.deadbeef", ROSTER)).toBeNull();
    expect(await readSession("unit-01", ROSTER)).toBeNull();
    expect(await readSession("", ROSTER)).toBeNull();
    expect(await readSession(undefined, ROSTER)).toBeNull();
  });

  it("refuses a cookie minted for a different officer", async () => {
    const cookie = await issueSession("unit-01", ROSTER);
    const swapped = `unit-02.${cookie.split(".")[1]}`;
    expect(await readSession(swapped, ROSTER)).toBeNull();
  });

  it("ends every session when the roster changes", async () => {
    const cookie = await issueSession("unit-01", ROSTER);
    const rewritten = JSON.stringify([
      { id: "unit-01", name: "A. Nyan", badge: "4417", passcode: "9999" },
    ]);
    expect(await readSession(cookie, rewritten)).toBeNull();
  });

  it("is named so the proxy and the sign-in route agree", () => {
    expect(OFFICER_COOKIE).toBe("paw-patrol-officer");
  });
});
