import { isValidToken } from "@/features/camera-triage/frame";
import { readFrameBody } from "@/features/camera-triage/readFrameBody";
import { parsePresencePost } from "@/features/live-video/presence";
import { publishPresence } from "@/features/live-video/presenceStore";

export const dynamic = "force-dynamic";
const MAX_BODY_BYTES = 256;

function failure(error: string, status = 400): Response {
  return Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
}

/** Protected by the same passphrase/officer-session proxy as signalling. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ sourceId: string }> },
): Promise<Response> {
  const { sourceId } = await params;
  if (!isValidToken(sourceId)) return failure("invalid-source");
  const received = await readFrameBody(request, MAX_BODY_BYTES);
  if (!received.ok) return failure(received.error, received.status);
  let body: unknown;
  try {
    body = JSON.parse(received.body);
  } catch {
    return failure("invalid-json");
  }
  const post = parsePresencePost(body);
  if (!post) return failure("invalid-presence", 422);
  try {
    await publishPresence(sourceId, post);
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  } catch {
    return failure("presence-store-unavailable", 503);
  }
}
