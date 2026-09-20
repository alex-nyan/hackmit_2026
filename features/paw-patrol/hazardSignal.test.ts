import { describe, expect, it } from "vitest";

import type { Hazard, HazardCategory, HazardSeverity, TriageResult } from "../camera-triage/types";
import type { TranscriptionResult } from "../camera-triage/audio";
import {
  distressTerms,
  hazardIncident,
  significantHazard,
  transcriptIncident,
} from "./hazardSignal";

const context = { personId: "P-01", scenarioAt: 15, sourceLabel: "Officer body camera" };

function hazard(category: HazardCategory, severity: HazardSeverity, confidence = 0.5): Hazard {
  return {
    category,
    severity,
    confidence,
    visual_evidence: "A dark object is held in the right hand.",
    uncertainty: "Low light; the object is partly occluded.",
    detection_indices: [0],
  };
}

function result(hazards: Hazard[]): TriageResult {
  return {
    request_id: "req-1",
    source_id: "officer-P-01",
    captured_at: "2026-09-19T22:00:00Z",
    processed_at: "2026-09-19T22:00:01Z",
    status: "needs_review",
    review_priority: "urgent",
    requires_human_review: true,
    assessment: {
      summary: "Possible weapon in frame.",
      hazards,
      image_quality: "adequate",
      limitations: ["Single frame"],
    },
    detections: [],
    models: [{ provider: "ollama", model: "gemma4:26b" }],
    warnings: [],
    timings_ms: {},
  };
}

describe("significantHazard", () => {
  it("alerts on a weapon or a person down at any severity", () => {
    expect(significantHazard(result([hazard("visible_weapon", "low")]))?.category).toBe(
      "visible_weapon",
    );
    expect(significantHazard(result([hazard("person_down", "low")]))?.category).toBe("person_down");
  });

  it("ignores an unrelated low-severity hazard", () => {
    expect(significantHazard(result([hazard("flooding", "low")]))).toBeNull();
    expect(significantHazard(result([hazard("blocked_access", "moderate")]))).toBeNull();
  });

  it("alerts on any hazard once it is high or critical", () => {
    expect(significantHazard(result([hazard("fire_smoke", "high")]))?.category).toBe("fire_smoke");
  });

  it("ranks severity above score", () => {
    // A confidently-detected `low` must not outrank a hesitant `critical`.
    const picked = significantHazard(
      result([hazard("visible_weapon", "low", 0.99), hazard("person_down", "critical", 0.11)]),
    );
    expect(picked?.category).toBe("person_down");
  });

  it("falls back to the score only within one severity", () => {
    const picked = significantHazard(
      result([hazard("visible_weapon", "high", 0.3), hazard("person_down", "high", 0.8)]),
    );
    expect(picked?.category).toBe("person_down");
  });

  it("returns nothing when the assessment is absent", () => {
    expect(significantHazard({ ...result([]), assessment: null })).toBeNull();
  });
});

describe("hazardIncident", () => {
  it("carries provenance and never claims confirmation", () => {
    const incident = hazardIncident(result([hazard("visible_weapon", "high", 0.42)]), context);
    expect(incident?.origin).toBe("model");
    expect(incident?.requiresHumanReview).toBe(true);
    expect(incident?.title).toContain("unverified");
    expect(incident?.provenance).toMatchObject({ provider: "ollama", model: "gemma4:26b" });
    // The score is stated, never as a probability.
    expect(incident?.detail).toContain("uncalibrated");
    expect(incident?.detail).toContain("Uncertainty:");
  });

  it("is stable in the request id so a retried frame cannot post twice", () => {
    const first = hazardIncident(result([hazard("person_down", "high")]), context);
    const second = hazardIncident(result([hazard("person_down", "high")]), context);
    expect(first?.id).toBe(second?.id);
  });

  it("returns nothing when no hazard is worth interrupting anyone for", () => {
    expect(hazardIncident(result([hazard("flooding", "low")]), context)).toBeNull();
  });
});

describe("distressTerms", () => {
  it("matches whole words only", () => {
    expect(distressTerms("I need help")).toContain("help");
    // "helping" must not read as a call for help.
    expect(distressTerms("thanks for helping out")).toEqual([]);
    expect(distressTerms("begun")).toEqual([]);
  });

  it("is case insensitive", () => {
    expect(distressTerms("SHOTS FIRED")).toContain("shots fired");
  });
});

describe("transcriptIncident", () => {
  const transcript = (text: string, speech = true): TranscriptionResult => ({
    request_id: "audio-1",
    text,
    speech_detected: speech,
    language: "en",
    language_probability: 0.9,
    duration_seconds: 10,
    segments: [],
    warnings: [],
  });

  it("publishes on a distress match and says what a transcript is", () => {
    const incident = transcriptIncident(transcript("officer down, send an ambulance"), context);
    expect(incident?.kind).toBe("transcript");
    expect(incident?.origin).toBe("model");
    expect(incident?.detail).toContain("model hypothesis");
    expect(incident?.detail).toContain("not a determination");
  });

  it("stays silent without a match, without speech, or on empty text", () => {
    expect(transcriptIncident(transcript("all quiet on the north side"), context)).toBeNull();
    expect(transcriptIncident(transcript("help", false), context)).toBeNull();
    expect(transcriptIncident(transcript(""), context)).toBeNull();
  });
});
