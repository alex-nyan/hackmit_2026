import { describe, expect, it } from "vitest";

import {
  ContractValidationError,
  parseIncidentEvent,
  parseIncidentSnapshot,
  parseTelemetryRequest,
  parseTranscriptionResult,
  parseTriageResult,
} from "../../shared/contracts";
import { transcriptFixture, triageFixture } from "./fixtures";

describe("generated incident contracts", () => {
  it("retains mandatory provenance, uncertainty and structured boxes", () => {
    const result = triageFixture();
    expect(parseTriageResult(result)).toBe(result);
    expect(result.detections[0].bbox.x2).toBe(0.4);
    expect(parseTranscriptionResult(transcriptFixture()).transcript_semantics).toBe(
      "machine_hypothesis_not_verbatim_record",
    );
  });

  it.each([
    "requires_human_review",
    "confidence_semantics",
    "models",
    "policy_version",
    "schema_version",
    "image_sha256",
  ])("rejects missing safety field %s instead of defaulting it", (key) => {
    const result: Record<string, unknown> = triageFixture();
    delete result[key];
    expect(() => parseTriageResult(result)).toThrow(ContractValidationError);
  });

  it.each([
    [0.1, 0.2, 0.4, 0.5],
    { x1: 0.4, y1: 0.2, x2: 0.1, y2: 0.5 },
    { x1: 0.1, y1: 0.2, x2: 0.1, y2: 0.5 },
    { x1: 0.1, y1: 0.2, x2: 1.5, y2: 0.5 },
    { x1: 0.1, y1: 0.2, x2: 0.4, y2: NaN },
  ])("rejects malformed, reversed, empty, out-of-range or nonfinite boxes", (bbox) => {
    const result = { ...triageFixture(), detections: [{ label: "knife", confidence: 0.7, bbox }] };
    expect(() => parseTriageResult(result)).toThrow(ContractValidationError);
  });

  it.each([
    { requires_human_review: false },
    { status: "safe" },
    { review_priority: "clear" },
    { timings_ms: { detector: Infinity } },
    { captured_at: "2026-02-30T00:00:00Z" },
    { captured_at: "2026-09-20T00:00:00" },
    { hidden_verdict: "safe" },
  ])("rejects invented enums, unsafe values, invalid timestamps and extra fields", (patch) => {
    expect(() => parseTriageResult({ ...triageFixture(), ...patch })).toThrow(
      ContractValidationError,
    );
  });

  it("rejects transcript intervals that end before they start", () => {
    const value = transcriptFixture();
    value.segments[0].end_seconds = -1;
    expect(() => parseTranscriptionResult(value)).toThrow(ContractValidationError);
    value.segments[0].start_seconds = 5;
    value.segments[0].end_seconds = 3;
    expect(() => parseTranscriptionResult(value)).toThrow(ContractValidationError);
  });

  it("allows optional input defaults while requiring them on output", () => {
    expect(() =>
      parseTelemetryRequest({
        incident_id: "incident-1",
        source_id: "watch-1",
        samples: [
          {
            kind: "heart_rate",
            sample_id: "sample-1",
            boot_id: "boot-1",
            sequence: 0,
            measured_at: "2026-09-20T01:00:00Z",
            value: { bpm: 82 },
          },
        ],
      }),
    ).not.toThrow();
    expect(() =>
      parseIncidentSnapshot({
        incident_id: "incident-1",
        revision: 0,
        generated_at: "2026-09-20T01:00:00Z",
        sources: [],
        observations: [],
        alerts: [],
        scene_reports: [],
      }),
    ).toThrow(ContractValidationError);
  });

  it("accepts invalidation events and rejects private extra payloads", () => {
    const event = {
      schema_version: "2.0",
      event_id: "event-1",
      incident_id: "incident-1",
      revision: 1,
      kind: "telemetry",
      recorded_at: "2026-09-20T01:00:00Z",
    };
    expect(parseIncidentEvent(event).revision).toBe(1);
    expect(() => parseIncidentEvent({ ...event, transcript: "private words" })).toThrow(
      ContractValidationError,
    );
  });
});
