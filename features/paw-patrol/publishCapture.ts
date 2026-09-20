import { parseTranscriptionResult, parseTriageResult } from "@/shared/contracts";
import { hazardIncident, transcriptIncident } from "./hazardSignal";
import { appendIncident } from "./incidentStore";
import { parseIncidentDraft, type IncidentDraft } from "./incidents";

/** Every capture client goes through these routes, including joined phones. */
export async function publishCapture(
  kind: "camera" | "audio",
  requestBody: unknown,
  outcome: { status: number; body: string },
): Promise<"published" | "none" | "failed"> {
  if (outcome.status !== 200) return "none";
  try {
    const request = requestBody as { source_id?: unknown; captured_at?: unknown };
    if (typeof request?.source_id !== "string") return "none";
    // Only the known demo capture prefix maps to its explicit profile.
    // Arbitrary phone IDs remain their own source, never an inferred subject.
    const personId = /^officer-P-\d{2}$/.test(request.source_id)
      ? request.source_id.slice(8)
      : request.source_id;
    const context = { personId, scenarioAt: null, sourceLabel: request.source_id };
    let draft: IncidentDraft | null;
    if (kind === "camera") {
      const result = parseTriageResult(JSON.parse(outcome.body));
      draft = hazardIncident(result, context);
      if (!draft && (result.assessment || result.detections.length > 0)) {
        draft = {
          id: `observation-${result.request_id}`,
          kind: "observation",
          origin: "model",
          ...context,
          source: request.source_id,
          title: `Camera context · unverified · ${personId}`,
          detail:
            result.assessment?.summary ??
            `Detector observations: ${result.detections.map((detection) => `${detection.label} (uncalibrated score ${detection.confidence.toFixed(2)})`).join(", ")}. Camera coordinates only; subject identity and location are not established.`,
          provenance: {
            provider: result.models[0]?.provider ?? "unknown",
            model: result.models[0]?.model ?? "unknown",
            confidence: null,
          },
          requiresHumanReview: true,
        };
      }
    } else {
      const result = parseTranscriptionResult(JSON.parse(outcome.body));
      draft = transcriptIncident(result, context);
      if (!draft && result.speech_detected && result.text) {
        draft = {
          id: `transcript-${result.request_id}`,
          kind: "transcript",
          origin: "model",
          ...context,
          source: request.source_id,
          title: `Audio context · unverified · ${personId}`,
          detail: `Transcript hypothesis: ${result.text}. Confirm with the crew.`,
          provenance: {
            provider: "faster_whisper",
            model: "whisper",
            confidence: result.language_probability,
          },
          requiresHumanReview: true,
        };
      }
    }
    if (!draft) return "none";
    draft.detail = draft.detail.slice(0, 600);
    if (typeof request.captured_at === "string") draft.observedAt = request.captured_at;
    const validated = parseIncidentDraft(draft);
    if (!validated) return "failed";
    await appendIncident(validated);
    return "published";
  } catch {
    // Inference remains usable when the shared log is down; expose this separately.
    return "failed";
  }
}
