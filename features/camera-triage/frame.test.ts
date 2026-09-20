import { describe, expect, it } from "vitest";

import {
  MAX_IMAGE_BASE64,
  buildTriageRequest,
  isValidToken,
  nextDelayMs,
  stripDataUrl,
  toSourceId,
} from "./frame";

const CAPTURED_AT = new Date("2026-09-19T21:00:00.000Z");
const DATA_URL = "data:image/jpeg;base64,AAABBBCCC==";

describe("source ids", () => {
  it("accepts what the service's pattern allows", () => {
    expect(isValidToken("unit-01")).toBe(true);
    expect(isValidToken("a.b:c_d-e")).toBe(true);
    expect(isValidToken("")).toBe(false);
    expect(isValidToken("unit 01")).toBe(false);
    expect(isValidToken("x".repeat(129))).toBe(false);
  });

  it("turns typed text into something the service accepts", () => {
    expect(toSourceId("Unit 02")).toBe("Unit-02");
    expect(toSourceId("  Car #7 (north)  ")).toBe("Car-7-north");
    expect(isValidToken(toSourceId("Car #7 (north)"))).toBe(true);
  });

  it("never produces an empty id", () => {
    expect(toSourceId("")).toBe("unknown-source");
    expect(toSourceId("###")).toBe("unknown-source");
  });

  it("clamps to the 128 character limit", () => {
    expect(isValidToken(toSourceId("y".repeat(400)))).toBe(true);
  });
});

describe("data urls", () => {
  it("strips the prefix Canvas adds", () => {
    expect(stripDataUrl(DATA_URL)).toBe("AAABBBCCC==");
  });

  it("rejects anything that is not jpeg base64", () => {
    expect(stripDataUrl("data:image/png;base64,AAA")).toBeNull();
    expect(stripDataUrl("AAABBB")).toBeNull();
    expect(stripDataUrl("")).toBeNull();
  });
});

describe("request body", () => {
  it("matches the service contract", () => {
    const body = buildTriageRequest({
      dataUrl: DATA_URL,
      sourceId: "Unit 02",
      capturedAt: CAPTURED_AT,
    });
    expect(body).toEqual({
      image_base64: "AAABBBCCC==",
      media_type: "image/jpeg",
      source_id: "Unit-02",
      captured_at: "2026-09-19T21:00:00.000Z",
      incident_id: null,
      allow_cloud: false,
    });
  });

  it("keeps cloud inference off by default", () => {
    const body = buildTriageRequest({
      dataUrl: DATA_URL,
      sourceId: "unit-01",
      capturedAt: CAPTURED_AT,
    });
    expect(body?.allow_cloud).toBe(false);
  });

  it("carries an incident id when one is given", () => {
    const body = buildTriageRequest({
      dataUrl: DATA_URL,
      sourceId: "unit-01",
      capturedAt: CAPTURED_AT,
      incidentId: "inc-42",
    });
    expect(body?.incident_id).toBe("inc-42");
  });

  it("refuses a frame the service would reject as oversized", () => {
    const huge = `data:image/jpeg;base64,${"A".repeat(MAX_IMAGE_BASE64 + 1)}`;
    expect(
      buildTriageRequest({ dataUrl: huge, sourceId: "unit-01", capturedAt: CAPTURED_AT }),
    ).toBeNull();
  });

  it("refuses an unusable data url rather than posting junk", () => {
    expect(
      buildTriageRequest({ dataUrl: "nope", sourceId: "unit-01", capturedAt: CAPTURED_AT }),
    ).toBeNull();
  });
});

describe("back-pressure", () => {
  it("keeps the base cadence while the service keeps up", () => {
    expect(nextDelayMs("ok", 2000)).toBe(2000);
  });

  it("waits longer after a busy or failed frame", () => {
    // The service admits one frame at a time and answers 429 when saturated.
    expect(nextDelayMs("busy", 500)).toBeGreaterThanOrEqual(1500);
    expect(nextDelayMs("error", 500)).toBeGreaterThanOrEqual(3000);
    expect(nextDelayMs("error", 500)).toBeGreaterThan(nextDelayMs("busy", 500));
  });

  it("never speeds up past the caller's base interval", () => {
    expect(nextDelayMs("busy", 5000)).toBe(5000);
    expect(nextDelayMs("error", 5000)).toBe(5000);
  });
});
