import type { TriageResult } from "../../shared/contracts";

import type { Encoding } from "./frameQuality";

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
      /**
       * The size and compression this capture has settled on. It moves with
       * the link, so it is reported rather than assumed by a reader.
       */
      encoding: Encoding;
      lastResult: TriageResult | null;
      lastError: string | null;
    };
