import type { TriageResult } from "../../shared/contracts";

export type {
  BoundingBox,
  Detection,
  Hazard,
  VisionAssessment,
  TriageRequest as TriageRequestBody,
  TriageResult,
} from "../../shared/contracts";

export type CaptureState =
  | { state: "idle" }
  | { state: "requesting-camera" }
  | { state: "denied"; reason: string }
  | { state: "unsupported"; reason: string }
  | { state: "running"; lastResult: TriageResult | null; lastError: string | null };
