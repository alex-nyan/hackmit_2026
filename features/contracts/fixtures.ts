import type { TranscriptionResult, TriageResult } from "../../shared/contracts";

export function triageFixture(overrides: Partial<TriageResult> = {}): TriageResult {
  return {
    schema_version: "1.0",
    request_id: "request-1",
    source_id: "iphone-camera-1",
    incident_id: "incident-1",
    captured_at: "2026-09-20T01:00:00Z",
    processed_at: "2026-09-20T01:00:01Z",
    image_sha256: "a".repeat(64),
    status: "needs_review",
    review_priority: "urgent",
    requires_human_review: true,
    confidence_semantics: "uncalibrated_model_scores",
    assessment: {
      summary: "Possible knife-like object visible",
      image_quality: "limited",
      hazards: [
        {
          category: "visible_weapon",
          severity: "high",
          confidence: 0.75,
          visual_evidence: "Elongated object near center",
          uncertainty: "Could be a tool; shape partially obscured",
          detection_indices: [0],
        },
      ],
      limitations: ["Single frame; no identity or intent inferred"],
    },
    detections: [{ label: "knife", confidence: 0.7, bbox: { x1: 0.1, y1: 0.2, x2: 0.4, y2: 0.5 } }],
    models: [{ provider: "ultralytics", model: "yolo26n", revision: null }],
    warnings: [],
    timings_ms: { yolo: 35 },
    policy_version: "human-review-v1",
    prompt_version: "visual-hazards-v1",
    ...overrides,
  };
}

export function transcriptFixture(
  overrides: Partial<TranscriptionResult> = {},
): TranscriptionResult {
  return {
    schema_version: "1.0",
    request_id: "request-2",
    source_id: "iphone-mic-1",
    incident_id: "incident-1",
    captured_at: "2026-09-20T01:00:00Z",
    processed_at: "2026-09-20T01:00:11Z",
    audio_sha256: "b".repeat(64),
    text: "dispatch we need backup",
    speech_detected: true,
    language: "en",
    language_probability: 0.98,
    duration_seconds: 10,
    segments: [
      {
        start_seconds: 0,
        end_seconds: 3,
        text: "dispatch we need backup",
        no_speech_probability: 0.1,
      },
    ],
    models: [{ provider: "faster_whisper", model: "base", revision: null }],
    warnings: [],
    timings_ms: { whisper: 40 },
    requires_human_review: true,
    confidence_semantics: "uncalibrated_model_scores",
    transcript_semantics: "machine_hypothesis_not_verbatim_record",
    ...overrides,
  };
}
