import { describe, expect, it } from "vitest";

import { pinnedElsewhere } from "./workspace";

describe("serving a role from its own route", () => {
  it("serves every role when the server is dedicated to none", () => {
    expect(pinnedElsewhere("officer", undefined)).toBe(false);
    expect(pinnedElsewhere("officer", "")).toBe(false);
  });

  it("serves the role a dedicated server was started for", () => {
    expect(pinnedElsewhere("officer", "officer")).toBe(false);
  });

  it("refuses the roles a dedicated server was not started for", () => {
    expect(pinnedElsewhere("dispatch", "officer")).toBe(true);
    expect(pinnedElsewhere("hospital", "officer")).toBe(true);
  });

  it("still rejects a workspace name the launcher would never set", () => {
    expect(() => pinnedElsewhere("officer", "sheriff")).toThrow(/PAW_PATROL_WORKSPACE/);
  });
});
