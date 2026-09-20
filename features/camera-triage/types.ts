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

/** Mirrors the `Hazard` contract in services/triage/triage/schemas.py. */
export type HazardCategory =
  | "fire_smoke"
  | "traffic_collision"
  | "blocked_access"
  | "structural_damage"
  | "flooding"
  | "electrical_hazard"
  | "person_down"
  | "visible_weapon"
  | "other";

export type HazardSeverity = "low" | "moderate" | "high" | "critical";

export interface Hazard {
  category: HazardCategory;
  severity: HazardSeverity;
  /** Uncalibrated model score. Never read this as a probability. */
  confidence: number;
  visual_evidence: string;
  uncertainty: string;
  detection_indices: number[];
}

export interface ModelProvenance {
  provider: string;
  model: string;
  revision?: string | null;
}

export interface VisionAssessment {
  summary: string;
  hazards: Hazard[];
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
  incident_id?: string | null;
  captured_at: string;
  processed_at: string;
  status: "needs_review" | "insufficient_evidence";
  review_priority: "immediate" | "urgent" | "routine" | "insufficient_evidence";
  /** Always true. The service has no "safe" outcome to report. */
  requires_human_review?: boolean;
  assessment: VisionAssessment | null;
  detections: Detection[];
  models?: ModelProvenance[];
  warnings: string[];
  timings_ms: Record<string, number>;
}

export type CaptureState =
  | { state: "idle" }
  | { state: "requesting-camera" }
  | { state: "denied"; reason: string }
  | { state: "unsupported"; reason: string }
  | {
      state: "running";
      /** The camera the browser actually handed over, which is the only
       *  honest answer to "is this the phone or the laptop?". */
      deviceLabel: string;
      /**
       * Whether this deployment has a triage service behind it at all.
       * Distinct from an error: frames still publish to the body camera wall,
       * there is simply no model reading them.
       */
      triageConfigured: boolean;
      lastResult: TriageResult | null;
      lastError: string | null;
    };
