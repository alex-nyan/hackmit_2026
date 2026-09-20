import type { TranscriptionResult } from "../camera-triage/audio";
import type { Hazard, HazardCategory, HazardSeverity, TriageResult } from "../camera-triage/types";
import type { IncidentDraft } from "./incidents";

/**
 * Turns real model output into an incident the workspaces share.
 *
 * Until this existed the "possible weapon" signal at 00:15 came from the demo
 * script while the triage service ran on a different page, feeding nothing. A
 * model result is now allowed to open an incident — but only as a model claim:
 * origin stays `model`, provenance travels with it, and the wording never
 * upgrades a detection into a confirmation.
 */

/** Operationally significant regardless of how the model scored severity. */
const ALWAYS_ALERTING: readonly HazardCategory[] = ["visible_weapon", "person_down"];

const SEVERITY_RANK: Record<HazardSeverity, number> = {
  low: 0,
  moderate: 1,
  high: 2,
  critical: 3,
};

const CATEGORY_LABELS: Record<HazardCategory, string> = {
  fire_smoke: "Fire or smoke",
  traffic_collision: "Traffic collision",
  blocked_access: "Blocked access",
  structural_damage: "Structural damage",
  flooding: "Flooding",
  electrical_hazard: "Electrical hazard",
  person_down: "Person down",
  visible_weapon: "Possible weapon",
  other: "Other hazard",
};

export function hazardLabel(category: HazardCategory): string {
  return CATEGORY_LABELS[category] ?? "Hazard";
}

function alerting(hazard: Hazard): boolean {
  if (ALWAYS_ALERTING.includes(hazard.category)) return true;
  return SEVERITY_RANK[hazard.severity] >= SEVERITY_RANK.high;
}

/**
 * The hazard worth putting in front of a person, or nothing. Ranked by severity
 * first and only then by score, because a low-scored `critical` still outranks
 * a confidently-detected `low` for the purpose of interrupting someone.
 */
export function significantHazard(result: TriageResult): Hazard | null {
  const hazards = result.assessment?.hazards ?? [];
  const candidates = hazards.filter(alerting);
  if (candidates.length === 0) return null;
  return candidates.reduce((best, hazard) => {
    const bySeverity = SEVERITY_RANK[hazard.severity] - SEVERITY_RANK[best.severity];
    if (bySeverity !== 0) return bySeverity > 0 ? hazard : best;
    return hazard.confidence > best.confidence ? hazard : best;
  });
}

interface SignalContext {
  personId: string;
  /** Demo clock position, so the shared log lines up with the scenario strip. */
  scenarioAt: number | null;
  sourceLabel: string;
}

export function hazardIncident(result: TriageResult, context: SignalContext): IncidentDraft | null {
  const hazard = significantHazard(result);
  if (!hazard) return null;

  const provider = result.models?.[0];
  return {
    // Stable in the request id so a retried frame cannot post twice.
    id: `hazard-${result.request_id}`,
    kind: "hazard",
    origin: "model",
    scenarioAt: context.scenarioAt,
    personId: context.personId,
    title: `${hazardLabel(hazard.category)} · unverified · ${context.personId}`,
    detail: [
      hazard.visual_evidence,
      `Uncertainty: ${hazard.uncertainty}`,
      `Severity reported as ${hazard.severity}. Score ${hazard.confidence.toFixed(2)} is an uncalibrated model value, not a probability.`,
    ].join(" "),
    source: context.sourceLabel,
    provenance: {
      provider: provider?.provider ?? "unknown",
      model: provider?.model ?? "unknown",
      confidence: hazard.confidence,
    },
    requiresHumanReview: true,
  };
}

/**
 * Words a transcript would contain if someone were calling for help. A match is
 * a lexical coincidence in a machine hypothesis about audio — it is not a
 * finding that anybody said anything, and the event says so.
 */
const DISTRESS_TERMS = [
  "chase",
  "pursuit",
  "suspect",
  "shots",
  "gunshot",
  "guns",
  "help",
  "help me",
  "shots fired",
  "officer down",
  "man down",
  "i'm hit",
  "im hit",
  "get back",
  "drop it",
  "gun",
  "weapon",
  "ambulance",
  "backup",
  "code three",
] as const;

export function distressTerms(text: string): string[] {
  const haystack = text.toLowerCase();
  return DISTRESS_TERMS.filter((term) => {
    const pattern = new RegExp(
      `(^|[^a-z])${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z]|$)`,
    );
    return pattern.test(haystack);
  });
}

export function transcriptIncident(
  result: TranscriptionResult,
  context: SignalContext,
): IncidentDraft | null {
  if (!result.speech_detected || !result.text) return null;
  const matched = distressTerms(result.text);
  if (matched.length === 0) return null;

  return {
    id: `transcript-${result.request_id}`,
    kind: "transcript",
    origin: "model",
    scenarioAt: context.scenarioAt,
    personId: context.personId,
    title: `Audio concern · unverified · ${context.personId}`,
    detail: [
      `Transcript hypothesis: "${result.text.slice(0, 240)}".`,
      `Matched terms: ${matched.join(", ")}.`,
      "A transcript is a model hypothesis, not a record of speech, and a matched word is not a determination that anyone is in danger.",
    ].join(" "),
    source: context.sourceLabel,
    provenance: {
      provider: "faster_whisper",
      model: "whisper",
      confidence: result.language_probability,
    },
    requiresHumanReview: true,
  };
}
