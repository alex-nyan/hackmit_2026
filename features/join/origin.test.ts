import { describe, expect, it } from "vitest";

import { JOIN_PATH, isLoopback, joinUrl, readOrigin } from "./origin";

function headers(entries: Record<string, string>): Headers {
  return new Headers(entries);
}

describe("readOrigin", () => {
  it("reports a deployment as scannable", () => {
    expect(
      readOrigin(headers({ host: "paw-patrol.vercel.app", "x-forwarded-proto": "https" })),
    ).toEqual({ origin: "https://paw-patrol.vercel.app", joinability: "ok" });
  });

  it("prefers the forwarded host, because behind a proxy Host is internal", () => {
    const resolved = readOrigin(
      headers({
        host: "10.0.0.7:3000",
        "x-forwarded-host": "paw-patrol.vercel.app",
        "x-forwarded-proto": "https",
      }),
    );
    expect(resolved?.origin).toBe("https://paw-patrol.vercel.app");
  });

  it("takes the first protocol when a proxy chain lists several", () => {
    const resolved = readOrigin(
      headers({ host: "paw-patrol.vercel.app", "x-forwarded-proto": "https,http" }),
    );
    expect(resolved?.joinability).toBe("ok");
  });

  it("refuses to promise a phone can reach localhost", () => {
    for (const host of ["localhost:5176", "127.0.0.1:5176", "[::1]:5176", "app.localhost"]) {
      expect(readOrigin(headers({ host }))?.joinability).toBe("loopback");
    }
  });

  it("marks a LAN address as unable to ask for a location", () => {
    // Reachable from a phone, but the browser refuses geolocation on plain
    // HTTP, so the scan would fail after the person had already walked over.
    expect(readOrigin(headers({ host: "192.168.1.14:5176" }))).toEqual({
      origin: "https://192.168.1.14:5176",
      joinability: "ok",
    });
    expect(readOrigin(headers({ host: "192.168.1.14:5176", "x-forwarded-proto": "http" }))).toEqual(
      { origin: "http://192.168.1.14:5176", joinability: "insecure" },
    );
  });

  it("keeps the port, which is most of what makes a LAN address work", () => {
    const resolved = readOrigin(
      headers({ host: "192.168.1.14:5176", "x-forwarded-proto": "https" }),
    );
    expect(resolved?.origin).toBe("https://192.168.1.14:5176");
  });

  it("has no answer without a host header", () => {
    expect(readOrigin(headers({}))).toBeNull();
  });
});

describe("isLoopback", () => {
  it("covers the whole 127 block, not just 127.0.0.1", () => {
    expect(isLoopback("127.5.5.5")).toBe(true);
  });

  it("does not mistake a routable address for loopback", () => {
    expect(isLoopback("10.0.0.1")).toBe(false);
    expect(isLoopback("paw-patrol.vercel.app")).toBe(false);
  });
});

describe("joinUrl", () => {
  it("appends the join path to the resolved origin", () => {
    expect(joinUrl("https://paw-patrol.vercel.app")).toBe(
      `https://paw-patrol.vercel.app${JOIN_PATH}`,
    );
  });
});
