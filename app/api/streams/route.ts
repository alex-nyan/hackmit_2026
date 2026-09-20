import { clearWall, listFrames, STALE_AFTER_MS } from "@/features/body-cam/store";
import { readTranscript } from "@/features/body-cam/transcripts";
import { PUBLISHER_TTL_MS } from "@/features/live-video/presence";
import { listPublishers } from "@/features/live-video/presenceStore";

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
  // Either store may be temporarily unavailable without taking healthy media
  // off screen. The flags let clients keep the last answer for that side.
  const [frameResult, publisherResult] = await Promise.allSettled([listFrames(), listPublishers()]);
  if (frameResult.status === "rejected" && publisherResult.status === "rejected") {
    return Response.json(
      { error: "discovery-unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  const frames = frameResult.status === "fulfilled" ? frameResult.value : [];
  // Read alongside the roster rather than by the tile, so a wall of officers
  // is still one round trip for the browser.
  const heard = await Promise.all(
    frames.map((frame) => readTranscript(frame.sourceId).catch(() => null)),
  );

  return Response.json(
    {
      frames: frames.map((frame, index) => ({
        ...frame,
        ...(heard[index] ? { heard: heard[index].text } : {}),
      })),
      staleAfterMs: STALE_AFTER_MS,
      publishers: publisherResult.status === "fulfilled" ? publisherResult.value : [],
      publisherTtlMs: PUBLISHER_TTL_MS,
      framesAvailable: frameResult.status === "fulfilled",
      publishersAvailable: publisherResult.status === "fulfilled",
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

/** Demo reset. Empties the wall for every watcher at once. */
export async function DELETE(): Promise<Response> {
  await clearWall();
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
