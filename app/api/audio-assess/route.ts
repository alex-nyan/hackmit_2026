import { readFrameBody } from "@/features/camera-triage/readFrameBody";
import { AudioAIError, assessTranscript, audioAISettings } from "@/features/audio-ai/provider";
import { publishAudioAssessment, publishAudioSafetySignal } from "@/features/audio-ai/publish";
import type { IncidentEvent } from "@/features/paw-patrol/incidents";
import { usesLocalIncidents } from "@/features/paw-patrol/localIncidentStore";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;
const headers = { "Cache-Control": "no-store" };

export function GET() {
  const settings = audioAISettings();
  return Response.json(
    {
      provider: settings.provider,
      model: settings.model,
      configured: settings.configured,
      transcription:
        process.env.TRIAGE_URL && process.env.TRIAGE_API_TOKEN ? "local-whisper" : "not-configured",
      incident_store: usesLocalIncidents()
        ? "local-shared-file"
        : process.env.BLOB_READ_WRITE_TOKEN
          ? "blob"
          : "not-configured",
      cloud: settings.provider === "openai" || settings.provider === "anthropic",
      safety_policy: "high-sensitivity-v1",
    },
    { headers },
  );
}

/** Transcript-only entry for native STT clients and clearly labelled demo inputs. */
export async function POST(request: Request) {
  const raw = await readFrameBody(request, 20_000);
  if (!raw.ok) return Response.json({ error: raw.error }, { status: raw.status, headers });
  let body;
  try {
    body = JSON.parse(raw.body);
  } catch {
    return Response.json({ error: "invalid-json" }, { status: 400, headers });
  }
  if (
    !body ||
    typeof body.text !== "string" ||
    !body.text.trim() ||
    body.text.length > 4000 ||
    typeof body.source_id !== "string" ||
    !/^[A-Za-z0-9_.:-]{1,128}$/.test(body.source_id)
  )
    return Response.json({ error: "invalid-audio-assessment-request" }, { status: 422, headers });
  const capturedAt = body.captured_at ?? new Date().toISOString();
  if (typeof capturedAt !== "string")
    return Response.json({ error: "invalid-capture-time" }, { status: 422, headers });
  const age = Date.now() - Date.parse(capturedAt);
  if (!Number.isFinite(age) || age < -10_000 || age > 120_000)
    return Response.json({ error: "stale-transcript" }, { status: 422, headers });
  let safetyAlert: IncidentEvent | null = null;
  let safetyPublication: "published" | "none" | "failed" = "none";
  try {
    safetyAlert = await publishAudioSafetySignal(
      body.text.trim(),
      "manual",
      body.source_id,
      capturedAt,
    );
    if (safetyAlert) safetyPublication = "published";
  } catch {
    safetyPublication = "failed";
  }
  const safety = { safety_alert: safetyAlert, safety_publication: safetyPublication };
  try {
    const assessment = await assessTranscript(body.text.trim(), "manual");
    try {
      const event = await publishAudioAssessment(assessment, body.source_id, capturedAt);
      return Response.json(
        {
          assessment,
          event,
          publication: "published",
          function: "report_audio_assessment",
          dispatch_executed: false,
          ...safety,
        },
        { headers },
      );
    } catch {
      return Response.json(
        {
          assessment,
          publication: "failed",
          function: "report_audio_assessment",
          dispatch_executed: false,
          ...safety,
        },
        { headers },
      );
    }
  } catch (error) {
    if (safetyAlert)
      return Response.json(
        {
          assessment: null,
          publication: "published",
          ...safety,
          ai_error: error instanceof AudioAIError ? error.code : "audio-ai-unavailable",
          dispatch_executed: false,
        },
        { headers },
      );
    return Response.json(
      { error: error instanceof AudioAIError ? error.code : "audio-ai-unavailable", ...safety },
      { status: error instanceof AudioAIError ? error.status : 503, headers },
    );
  }
}
