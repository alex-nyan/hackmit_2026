import { describe, expect, it } from "vitest";

import { COOKIE_NAME, digest, isOpenPath, matches, requiredPassphrase } from "./passphrase";

describe("deciding whether the app is gated", () => {
  it("is open when no passphrase is configured", () => {
    expect(requiredPassphrase({})).toBeNull();
    expect(requiredPassphrase({ PAW_PATROL_PASSPHRASE: "" })).toBeNull();
    expect(requiredPassphrase({ PAW_PATROL_PASSPHRASE: "   " })).toBeNull();
  });

  it("is gated once one is set", () => {
    expect(requiredPassphrase({ PAW_PATROL_PASSPHRASE: " hunter2 " })).toBe("hunter2");
  });
});

describe("paths the gate must not close", () => {
  it("leaves the form and its handler reachable", () => {
    expect(isOpenPath("/unlock")).toBe(true);
    expect(isOpenPath("/api/unlock")).toBe(true);
  });

  it("closes everything else", () => {
    for (const path of ["/", "/dispatch", "/capture", "/api/streams", "/unlocked"]) {
      expect(isOpenPath(path)).toBe(false);
    }
  });
});

describe("the cookie", () => {
  it("carries a digest, never the passphrase itself", async () => {
    const hashed = await digest("hunter2");
    expect(hashed).toMatch(/^[0-9a-f]{64}$/);
    expect(hashed).not.toContain("hunter2");
  });

  it("gives a different digest for a different passphrase", async () => {
    expect(await digest("hunter2")).not.toBe(await digest("hunter3"));
  });

  it("is named so the proxy and the route agree", () => {
    expect(COOKIE_NAME).toBe("paw-patrol-access");
  });
});

describe("comparing", () => {
  it("accepts an exact match and rejects anything else", () => {
    expect(matches("abc", "abc")).toBe(true);
    expect(matches("abc", "abd")).toBe(false);
    expect(matches("abc", "ab")).toBe(false);
    expect(matches("", "")).toBe(true);
  });
});
