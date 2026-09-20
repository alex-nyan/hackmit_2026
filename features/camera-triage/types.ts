import type { TriageResult } from "../../shared/contracts";

export type {
  BoundingBox,
  Detection,
  Hazard,
  VisionAssessment,
  ModelProvenance,
  TriageRequest as TriageRequestBody,
  TriageResult,
} from "../../shared/contracts";

export type HazardCategory = import("../../shared/contracts").Hazard["category"];
export type HazardSeverity = import("../../shared/contracts").Hazard["severity"];

export type CaptureState =
  | { state: "idle" }
  | { state: "requesting-camera" }
  | { state: "denied"; reason: string }
  | { state: "unsupported"; reason: string }
  | { state: "running"; lastResult: TriageResult | null; lastError: string | null };
