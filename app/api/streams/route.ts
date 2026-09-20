import { clearWall, listFrames, STALE_AFTER_MS } from "@/features/body-cam/store";

/**
 * The body camera roster, polled.
 *
 * The incident log is an event stream because it is a log: a subscriber wants
 * everything that happened while it was away. The wall is the opposite — it
 * holds only the latest frame per officer, so there is no backlog to miss and
 * a watcher only ever wants the current answer. Polling gives exactly that,
 * and unlike an open stream it does not pin a server instance per viewer.
 */

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const frames = await listFrames();
  return Response.json(
    { frames, staleAfterMs: STALE_AFTER_MS },
    { headers: { "Cache-Control": "no-store" } },
  );
}

/** Demo reset. Empties the wall for every watcher at once. */
export async function DELETE(): Promise<Response> {
  await clearWall();
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
