import { readFrameBody } from "@/features/camera-triage/readFrameBody";
import {
  forwardFrame,
  MAX_BODY_BYTES,
  readTriageSettings,
} from "@/features/camera-triage/triageProxy";

/**
 * Server-side bridge to the triage service. The service's bearer token is read
 * from the environment and never reaches the browser; the phone posts here.
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

  const frame = await readFrameBody(request, MAX_BODY_BYTES);
  if (!frame.ok) {
    return Response.json(
      { error: frame.error },
      { status: frame.status, headers: { "Cache-Control": "no-store" } },
    );
  }

  const outcome = await forwardFrame(
    settings,
    request.headers.get("idempotency-key") ?? "",
    frame.body,
  );

  return new Response(outcome.body, {
    status: outcome.status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
