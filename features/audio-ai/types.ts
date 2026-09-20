export const AUDIO_STATUSES = [
  "no_threat_detected",
  "uncertain",
  "potential_threat",
  "urgent_threat",
] as const;
export type AudioThreatStatus = (typeof AUDIO_STATUSES)[number];
export type AudioAction =
  "monitor" | "contact_officer" | "review_for_backup" | "urgent_backup_review";

/** Conservative demo review threshold; this is not a calibrated safety cutoff. */
const MIN_MONITOR_CONFIDENCE = 0.6;

export const ACTION_FOR_STATUS: Record<AudioThreatStatus, AudioAction> = {
  no_threat_detected: "monitor",
  uncertain: "contact_officer",
  potential_threat: "review_for_backup",
  urgent_threat: "urgent_backup_review",
};
export const STATUS_LABELS: Record<AudioThreatStatus, string> = {
  no_threat_detected: "No threat detected in this clip",
  uncertain: "Needs clarification",
  potential_threat: "Possible threat",
  urgent_threat: "Urgent threat reported",
};
export const ACTION_LABELS: Record<AudioAction, string> = {
  monitor: "Continue monitoring",
  contact_officer: "Contact officer to clarify",
  review_for_backup: "Review need for backup",
  urgent_backup_review: "Urgent dispatcher review for backup",
};

export interface AudioAssessment {
  status: AudioThreatStatus;
  /** Model's self-reported score, not a calibrated probability of danger. */
  confidence: number;
  summary: string;
  evidence: string[];
  uncertainty: string;
  recommended_action: AudioAction;
}

export interface AudioAssessmentRecord extends AudioAssessment {
  provider: "ollama" | "openai" | "anthropic";
  model: string;
  latency_ms: number;
  transcript: string;
  input_kind: "microphone" | "manual";
}

export function audioAssessmentLabel(assessment: AudioAssessment): string {
  return assessment.status === "no_threat_detected" &&
    assessment.confidence < MIN_MONITOR_CONFIDENCE
    ? "Low-confidence result — needs clarification"
    : STATUS_LABELS[assessment.status];
}

export function parseAudioAssessment(value: unknown): AudioAssessment | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (!AUDIO_STATUSES.includes(raw.status as AudioThreatStatus)) return null;
  const status = raw.status as AudioThreatStatus;
  if (
    typeof raw.confidence !== "number" ||
    !Number.isFinite(raw.confidence) ||
    raw.confidence < 0 ||
    raw.confidence > 1
  )
    return null;
  for (const field of ["summary", "uncertainty"] as const) {
    if (typeof raw[field] !== "string" || !raw[field].trim() || raw[field].length > 600)
      return null;
  }
  if (
    !Array.isArray(raw.evidence) ||
    raw.evidence.length > 4 ||
    raw.evidence.some((item) => typeof item !== "string" || !item.trim() || item.length > 300)
  )
    return null;
  return {
    status,
    confidence: raw.confidence,
    summary: (raw.summary as string).trim(),
    evidence: raw.evidence as string[],
    uncertainty: (raw.uncertainty as string).trim(),
    recommended_action:
      status === "no_threat_detected" && raw.confidence < MIN_MONITOR_CONFIDENCE
        ? "contact_officer"
        : ACTION_FOR_STATUS[status],
  };
}

export function parseAudioAssessmentRecord(value: unknown): AudioAssessmentRecord | null {
  const assessment = parseAudioAssessment(value);
  if (!assessment || !value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (
    !["ollama", "openai", "anthropic"].includes(String(raw.provider)) ||
    typeof raw.model !== "string" ||
    !raw.model ||
    raw.model.length > 128 ||
    typeof raw.latency_ms !== "number" ||
    !Number.isFinite(raw.latency_ms) ||
    raw.latency_ms < 0 ||
    typeof raw.transcript !== "string" ||
    raw.transcript.length > 4000 ||
    !["microphone", "manual"].includes(String(raw.input_kind))
  )
    return null;
  return {
    ...assessment,
    provider: raw.provider as AudioAssessmentRecord["provider"],
    model: raw.model,
    latency_ms: raw.latency_ms,
    transcript: raw.transcript,
    input_kind: raw.input_kind as AudioAssessmentRecord["input_kind"],
  };
}
