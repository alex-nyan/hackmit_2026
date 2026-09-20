import { parseTranscript, publishTranscript } from "@/features/body-cam/transcripts";
import { readFrameBody } from "@/features/camera-triage/readFrameBody";
import { forwardClip } from "@/features/camera-triage/transcribeProxy";
import { MAX_BODY_BYTES, readTriageSettings } from "@/features/camera-triage/triageProxy";

/**
 * Server-side bridge to the transcription endpoint. The bearer token is read
 * from the environment and never reaches the browser.
 */
export const dynamic = "force-dynamic";

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
    if (sourceId && text) await publishTranscript(sourceId, text);
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

  return new Response(outcome.body, {
    status: outcome.status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
