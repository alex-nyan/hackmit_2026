import { forwardClip } from "@/features/camera-triage/transcribeProxy";
import { readTriageSettings } from "@/features/camera-triage/triageProxy";

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

  const outcome = await forwardClip(settings, await request.text());
  return new Response(outcome.body, {
    status: outcome.status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
