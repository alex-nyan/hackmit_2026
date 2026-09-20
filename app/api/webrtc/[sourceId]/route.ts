import { isCursor, isPeerId, isSignalSource, parseSignalPost } from "@/features/live-video/signal";
import { postSignal, readSignals } from "@/features/live-video/signalStore";

/**
 * One source's signalling mailbox.
 *
 * Polled, like the incident log and for the same reason: an event stream
 * would hold a server instance open for every browser waiting to connect,
 * and on a platform that answers each request from whichever instance is free
 * the publisher and the watcher are rarely on the same one. A cursor gives
 * the same guarantee without either problem.
 *
 * This route carries descriptions, bounded candidate batches and departures.
 * Audio and video always travel through the peer connection.
 */

export const dynamic = "force-dynamic";

/** An SDP with its candidates inline, with room to spare. */
const MAX_BODY_BYTES = 96_000;

function badRequest(error: string, status = 400): Response {
  return Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ sourceId: string }> },
): Promise<Response> {
  const { sourceId } = await params;
  if (!isSignalSource(sourceId)) return badRequest("invalid-source");

  const query = new URL(request.url).searchParams;
  const since = query.get("since") ?? "";
  const peer = query.get("peer") ?? "";
  // A reader must name itself: it is what decides which message bodies are
  // worth fetching, and an unnamed one would pay for everybody's.
  if (!isCursor(since) || !isPeerId(peer)) return badRequest("invalid-cursor");

  try {
    return Response.json(await readSignals(sourceId, since, peer), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return badRequest("signal-store-unavailable", 503);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ sourceId: string }> },
): Promise<Response> {
  const { sourceId } = await params;
  if (!isSignalSource(sourceId)) return badRequest("invalid-source");

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return badRequest("too-large", 413);

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return badRequest("invalid-json");
  }

  const post = parseSignalPost(body);
  if (!post) return badRequest("invalid-signal", 422);

  try {
    const message = await postSignal(sourceId, post);
    return Response.json(
      { cursor: message.cursor, at: message.at },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    // A handshake that cannot be posted is a connection that will not happen.
    // The watcher retries, and meanwhile the frame tile is still the picture.
    return badRequest("signal-store-unavailable", 503);
  }
}
