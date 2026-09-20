import { MEDIA_TYPE } from "@/features/body-cam/frames";
import { readFrame, readFrameAt } from "@/features/body-cam/store";
import { isValidToken } from "@/features/camera-triage/frame";

/**
 * One officer's latest frame, as bytes.
 *
 * Watchers reach this through an `<img>` rather than the roster, so the
 * browser handles fetching, cancelling and decoding, and one officer's upload
 * is not multiplied by the number of people watching. The `at` query only
 * makes each frame its own URL; the server always answers with the latest,
 * and a stale source is a 404 rather than an old picture.
 */

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ sourceId: string }> },
): Promise<Response> {
  const { sourceId } = await params;
  if (!isValidToken(sourceId)) {
    return Response.json(
      { error: "invalid-source" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  // `at` names a moment in the archive. Without it this is the live tile,
  // where the same query doubles as the cache key for the latest frame.
  const at = Number.parseInt(new URL(request.url).searchParams.get("at") ?? "", 10);
  const wantsArchive = Number.isSafeInteger(at) && at > 0;
  const stream = wantsArchive ? await readFrameAt(sourceId, at) : await readFrame(sourceId);
  if (!stream) {
    return Response.json(
      { error: "no-frame" },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }

  return new Response(stream, {
    headers: { "Content-Type": MEDIA_TYPE, "Cache-Control": "no-store" },
  });
}
