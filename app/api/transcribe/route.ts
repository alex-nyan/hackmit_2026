import { publishCapture } from "@/features/paw-patrol/publishCapture";
import { parseTranscript, publishTranscript } from "@/features/body-cam/transcripts";
import { readFrameBody } from "@/features/camera-triage/readFrameBody";
import { forwardClip } from "@/features/camera-triage/transcribeProxy";
import { MAX_BODY_BYTES, readTriageSettings } from "@/features/camera-triage/triageProxy";
import { parseTranscriptionResult } from "@/shared/contracts";
import { AudioAIError, assessTranscript, audioAISettings } from "@/features/audio-ai/provider";
import { publishAudioAssessment } from "@/features/audio-ai/publish";

/**
 * Server-side bridge to the transcription endpoint. The bearer token is read
 * from the environment and never reaches the browser.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Puts what was heard beside the officer's tile.
 *
 * Best effort on purpose: a dashboard that cannot show a transcript is a
 * smaller problem than a capture page that stops transcribing because it
 * could not.
 */
async function teeToWall(
  requestBody: string,
  outcome: { status: number; body: string },
): Promise<void> {
  if (outcome.status !== 200) return;
  try {
    const sourceId = String(JSON.parse(requestBody)?.source_id ?? "");
    const text = parseTranscript(JSON.parse(outcome.body));
    if (sourceId && text && process.env.BLOB_READ_WRITE_TOKEN)
      await publishTranscript(sourceId, text);
  } catch {
    // Unparseable either way; the caller still gets the service's own answer.
  }
}

export async function POST(request: Request) {
  const settings = readTriageSettings(process.env);
  if (!settings) {
    return Response.json(
      { error: "not-configured", reason: "Set TRIAGE_URL and TRIAGE_API_TOKEN." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  const clip = await readFrameBody(request, MAX_BODY_BYTES);
  if (!clip.ok) {
    return Response.json(
      { error: clip.error === "frame-too-large" ? "clip-too-large" : clip.error },
      { status: clip.status, headers: { "Cache-Control": "no-store" } },
    );
  }

  const outcome = await forwardClip(settings, clip.body);
  await teeToWall(clip.body, outcome);

  let parsed: unknown = null;
  try {
    parsed = JSON.parse(clip.body);
  } catch {
    /* Invalid request is already rejected upstream. */
  }
  let publication: "published" | "none" | "failed" = "none";
  let analysisStatus = "disabled";
  if (outcome.status === 200 && audioAISettings().provider !== "disabled") {
    try {
      const transcript = parseTranscriptionResult(JSON.parse(outcome.body));
      if (transcript.speech_detected && transcript.text.trim()) {
        // Retain the original transcription contract; structured assessment travels in the shared log.
        const assessment = await assessTranscript(transcript.text.slice(0, 4000), "microphone");
        analysisStatus =
          assessment.status === "no_threat_detected" &&
          assessment.recommended_action === "contact_officer"
            ? "uncertain"
            : assessment.status;
        try {
          await publishAudioAssessment(assessment, transcript.source_id, transcript.captured_at);
          publication = "published";
        } catch {
          publication = "failed";
        }
      } else analysisStatus = "no-speech";
    } catch (error) {
      analysisStatus = error instanceof AudioAIError ? error.code : "audio-ai-unavailable";
      // Keep the transcript visible when semantic analysis is unavailable.
      // This fallback is explicitly a phrase match, never a successful AI assessment.
      publication = await publishCapture("audio", parsed, outcome);
    }
  } else publication = await publishCapture("audio", parsed, outcome);
  return new Response(outcome.body, {
    status: outcome.status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Incident-Publication": publication,
      "X-Audio-Assessment": analysisStatus,
    },
  });
}
