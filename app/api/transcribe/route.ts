import { readFrameBody } from "@/features/camera-triage/readFrameBody";
import { forwardClip } from "@/features/camera-triage/transcribeProxy";
import { MAX_BODY_BYTES, readTriageSettings } from "@/features/camera-triage/triageProxy";

/**
 * Server-side bridge to the transcription endpoint. The bearer token is read
 * from the environment and never reaches the browser.
 */
export const dynamic = "force-dynamic";

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
  return new Response(outcome.body, {
    status: outcome.status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
