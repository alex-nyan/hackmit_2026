import { HISTORY_WINDOW_MS, listHistory } from "@/features/body-cam/store";

/**
 * What one officer published inside the review window.
 *
 * Timestamps only. Each is a URL the reviewer can fetch when the scrubber
 * lands on it, which keeps stepping through an archive as cheap as looking
 * at the live tile.
 */
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ sourceId: string }> },
): Promise<Response> {
  const { sourceId } = await params;
  const frames = await listHistory(sourceId);
  return Response.json(
    { sourceId, frames, windowMs: HISTORY_WINDOW_MS },
    { headers: { "Cache-Control": "no-store" } },
  );
}
