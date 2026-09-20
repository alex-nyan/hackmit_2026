import "server-only";
import { createHash } from "node:crypto";
import { listPublishedDevices } from "../live-track/positionStore";
import { appendIncident } from "../paw-patrol/incidentStore";
import {
  parseIncidentDraft,
  type IncidentDraft,
  type IncidentEvent,
} from "../paw-patrol/incidents";
import { ACTION_LABELS, audioAssessmentLabel, type AudioAssessmentRecord } from "./types";
import { detectSafetyPhrase, safetySignalLabel } from "./safetySignal";

export function assessmentId(sourceId: string, capturedAt: string, transcript: string) {
  return `audio-ai-${createHash("sha256")
    .update(JSON.stringify([sourceId, capturedAt, transcript]))
    .digest("hex")
    .slice(0, 32)}`;
}

/** Publish before the slower LLM call, including when the provider is unavailable. */
export async function publishAudioSafetySignal(
  transcript: string,
  inputKind: "microphone" | "manual",
  sourceId: string,
  capturedAt: string,
): Promise<IncidentEvent | null> {
  const detected = detectSafetyPhrase(transcript);
  if (!detected) return null;
  const signal = {
    ...detected,
    transcript,
    input_kind: inputKind,
    assessment_id: assessmentId(sourceId, capturedAt, transcript),
  };
  const personId = /^officer-P-\d{2}$/.test(sourceId) ? sourceId.slice(8) : sourceId;
  const draft = parseIncidentDraft({
    id: signal.assessment_id.replace("audio-ai-", "audio-safety-"),
    kind: "transcript",
    origin: "model",
    scenarioAt: null,
    personId,
    source: sourceId,
    observedAt: capturedAt,
    title: `Audio concern · ${safetySignalLabel(signal)} · ${personId}`,
    detail: `High-sensitivity phrase match: ${signal.matches.join(", ")}. Contact the officer and review ${signal.level === "urgent" ? "backup urgently" : "the need for backup"}. Negation, quotation and training context may cause false positives. No units dispatched.`,
    provenance: { provider: "phrase-rules", model: "high-sensitivity-v1", confidence: null },
    requiresHumanReview: true,
    audioSafetySignal: signal,
  });
  if (!draft) throw new Error("Invalid audio safety signal");
  return appendIncident(draft);
}

export async function publishAudioAssessment(
  assessment: AudioAssessmentRecord,
  sourceId: string,
  capturedAt: string,
): Promise<IncidentEvent> {
  const personId = /^officer-P-\d{2}$/.test(sourceId) ? sourceId.slice(8) : sourceId;
  const concern = assessment.status === "urgent_threat" || assessment.status === "potential_threat";
  const phraseReview = detectSafetyPhrase(assessment.transcript);
  const draft: IncidentDraft = {
    id: assessmentId(sourceId, capturedAt, assessment.transcript),
    kind: "transcript",
    origin: "model",
    scenarioAt: null,
    personId,
    source: sourceId,
    observedAt: capturedAt,
    title: phraseReview
      ? `AI context · independent phrase review required · ${personId}`
      : `${concern ? "Audio concern" : "Audio assessment"} · ${audioAssessmentLabel(assessment)} · ${personId}`,
    detail:
      `${phraseReview ? "Independent phrase alert requires human review. Model context: " : ""}${assessment.summary} Recommendation: ${ACTION_LABELS[assessment.recommended_action]}. Uncertainty: ${assessment.uncertainty}`.slice(
        0,
        600,
      ),
    provenance: {
      provider: assessment.provider,
      model: assessment.model,
      confidence: assessment.confidence,
    },
    requiresHumanReview: true,
    audioAssessment: assessment,
  };
  // GPS annotates the reporting device, not a person mentioned in the recording.
  if (process.env.BLOB_READ_WRITE_TOKEN && assessment.input_kind === "microphone") {
    try {
      const { devices } = await listPublishedDevices();
      const fix = devices.find((device) => device.id === sourceId)?.fix;
      if (
        fix?.freshness === "live" &&
        Math.abs(Date.parse(fix.fixedAt) - Date.parse(capturedAt)) <= 90_000
      )
        draft.location = {
          longitude: fix.longitude,
          latitude: fix.latitude,
          fixedAt: fix.fixedAt,
          accuracyMeters: fix.accuracyMeters,
        };
    } catch {
      /* Audio assessment remains useful without GPS. */
    }
  }
  const validated = parseIncidentDraft(draft);
  if (!validated) throw new Error("Invalid audio incident");
  return appendIncident(validated);
}
