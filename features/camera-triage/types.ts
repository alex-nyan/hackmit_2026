/** Mirrors services/triage/contracts/triage-request.schema.json. */
export interface TriageRequestBody {
  image_base64: string;
  media_type: "image/jpeg";
  source_id: string;
  captured_at: string;
  incident_id?: string | null;
  allow_cloud?: boolean;
}

export interface Detection {
  label: string;
  confidence: number;
  bbox: number[];
}

export interface VisionAssessment {
  summary: string;
  hazards: unknown[];
  image_quality: string | null;
  limitations: string[] | null;
}

/**
 * The service never returns a clean bill of health: `status` is only ever
 * `needs_review` or `insufficient_evidence`, and `requires_human_review` is a
 * constant true. Treat every result as a prompt for a person, not a verdict.
 */
export interface TriageResult {
  request_id: string;
  source_id: string;
  captured_at: string;
  processed_at: string;
  status: "needs_review" | "insufficient_evidence";
  review_priority: "immediate" | "urgent" | "routine" | "insufficient_evidence";
  assessment: VisionAssessment | null;
  detections: Detection[];
  warnings: string[];
  timings_ms: Record<string, number>;
}

export type CaptureState =
  | { state: "idle" }
  | { state: "requesting-camera" }
  | { state: "denied"; reason: string }
  | { state: "unsupported"; reason: string }
  | { state: "running"; lastResult: TriageResult | null; lastError: string | null };
