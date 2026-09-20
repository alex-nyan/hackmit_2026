import { parseFrameSubmission } from "@/features/body-cam/frames";
import { publishFrame } from "@/features/body-cam/store";
import { readFrameBody } from "@/features/camera-triage/readFrameBody";
import {
  forwardFrame,
  MAX_BODY_BYTES,
  readTriageSettings,
} from "@/features/camera-triage/triageProxy";

/**
 * Server-side bridge to the triage service. The service's bearer token is read
 * from the environment and never reaches the browser; the phone posts here.
 *
 * Every frame that passes through also lands on the body camera wall, which is
 * why an officer's phone uploads once and both the model and the other
 * workspaces are served from it.
 */
export const dynamic = "force-dynamic";

/**
 * The wall is fed before triage is even consulted, so it keeps working when
 * the service is unconfigured, down, or busy refusing frames. Watching each
 * other does not depend on a model being available.
 */
async function teeToWall(body: string): Promise<void> {
  try {
    const submission = parseFrameSubmission(JSON.parse(body));
    if (submission) await publishFrame(submission);
  } catch {
    // A body triage will reject anyway, or a store that refused it. Never the
    // caller's problem: this route's contract is with the triage service.
  }
}

export async function POST(request: Request) {
  const frame = await readFrameBody(request, MAX_BODY_BYTES);
  if (!frame.ok) {
    return Response.json(
      { error: frame.error },
      { status: frame.status, headers: { "Cache-Control": "no-store" } },
    );
  }

  // Awaited rather than left running: work that outlives the response is not
  // guaranteed to finish on a serverless instance, and a dropped write is a
  // tile that never appears.
  await teeToWall(frame.body);

  const settings = readTriageSettings(process.env);
  if (!settings) {
    return Response.json(
      { error: "not-configured", reason: "Set TRIAGE_URL and TRIAGE_API_TOKEN." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
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
