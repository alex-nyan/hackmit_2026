import { describe, expect, it } from "vitest";

import { describeOrigin, parseIncidentDraft, type IncidentEvent } from "./incidents";

const valid = {
  id: "hazard-abc",
  kind: "hazard",
  origin: "model",
  scenarioAt: 15,
  title: "Possible weapon · unverified · P-01",
  detail: "A dark object is held in the right hand.",
  source: "Officer body camera",
  personId: "P-01",
  provenance: { provider: "ollama", model: "gemma4:26b", confidence: 0.42 },
  requiresHumanReview: true,
};

describe("parseIncidentDraft", () => {
  it("accepts a well-formed model event", () => {
    expect(parseIncidentDraft(valid)).toMatchObject({
      id: "hazard-abc",
      kind: "hazard",
      origin: "model",
      personId: "P-01",
    });
  });

  it("accepts an operator event with no provenance", () => {
    const draft = parseIncidentDraft({
      ...valid,
      kind: "panic",
      origin: "operator",
      provenance: null,
    });
    expect(draft?.provenance).toBeNull();
  });

  it("rejects a model event with no provenance", () => {
    // An unattributable model claim sitting next to a person's report is the
    // exact confusion this contract exists to prevent.
    expect(parseIncidentDraft({ ...valid, provenance: null })).toBeNull();
  });

  it.each([
    ["unknown kind", { kind: "telemetry" }],
    ["unknown origin", { origin: "sensor" }],
    ["missing title", { title: "" }],
    ["missing source", { source: "   " }],
    ["non-boolean review flag", { requiresHumanReview: "yes" }],
    ["negative scenario time", { scenarioAt: -1 }],
    ["non-finite scenario time", { scenarioAt: Number.NaN }],
    ["confidence above one", { provenance: { provider: "o", model: "m", confidence: 1.4 } }],
    ["confidence below zero", { provenance: { provider: "o", model: "m", confidence: -0.1 } }],
  ])("rejects %s", (_label, patch) => {
    expect(parseIncidentDraft({ ...valid, ...patch })).toBeNull();
  });

  it("rejects non-objects", () => {
    expect(parseIncidentDraft(null)).toBeNull();
    expect(parseIncidentDraft("hazard")).toBeNull();
    expect(parseIncidentDraft(42)).toBeNull();
  });

  it("allows a null score without discarding the provenance", () => {
    const draft = parseIncidentDraft({
      ...valid,
      provenance: { provider: "faster_whisper", model: "base", confidence: null },
    });
    expect(draft?.provenance).toEqual({
      provider: "faster_whisper",
      model: "base",
      confidence: null,
    });
  });

  it("does not trust a client-supplied sequence or timestamp", () => {
    const draft = parseIncidentDraft({ ...valid, seq: 999, at: "1970-01-01T00:00:00.000Z" });
    expect(draft).not.toHaveProperty("seq");
    expect(draft).not.toHaveProperty("at");
  });
});

describe("describeOrigin", () => {
  it("never describes a model claim as an observation", () => {
    const event = { ...valid, seq: 1, at: "" } as IncidentEvent;
    expect(describeOrigin(event)).toBe("Model output · unreviewed");
    expect(describeOrigin({ ...event, origin: "operator" })).toBe("Reported by a person");
    expect(describeOrigin({ ...event, origin: "script" })).toBe("Scripted scenario");
  });
});
