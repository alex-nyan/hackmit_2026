import { isValidToken } from "@/features/camera-triage/frame";
import { parsePositionSubmission } from "@/features/live-track/devicePosition";
import {
  clearPositions,
  isPositionStoreConfigured,
  publishPosition,
  removePosition,
} from "@/features/live-track/positionStore";

/**
 * Where a phone publishes where it is.
 *
 * Separate from the frame upload on purpose: a unit's position is worth having
 * whether or not that unit's camera is running, and someone who turns the
 * camera off to save battery should not vanish from the map.
 *
 * Nothing here is durable and nothing is a track. The store holds the latest
 * fix per unit, a reset empties it, and it is not evidence of where anyone was.
 */

export const dynamic = "force-dynamic";

/** A fix is a few hundred bytes; anything larger is not one. */
const MAX_BODY_BYTES = 2_048;

export async function POST(request: Request): Promise<Response> {
  if (!isPositionStoreConfigured()) {
    return Response.json(
      { error: "not-configured", reason: "Set BLOB_READ_WRITE_TOKEN." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    return Response.json(
      { error: "too-large" },
      { status: 413, headers: { "Cache-Control": "no-store" } },
    );
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return Response.json(
      { error: "invalid-json" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const submission = parsePositionSubmission(body);
  if (!submission) {
    return Response.json(
      { error: "invalid-position" },
      { status: 422, headers: { "Cache-Control": "no-store" } },
    );
  }

  const stored = await publishPosition(submission);
  return Response.json(
    { sourceId: stored.sourceId, publishedAt: stored.publishedAt },
    { status: 201, headers: { "Cache-Control": "no-store" } },
  );
}

/**
 * Withdraws one unit, or resets the whole demo.
 *
 * `?sourceId=` is somebody pressing stop: they left, and a marker that fades
 * out over the next half hour would have a dispatcher reading a unit that is
 * not there. Without it this is the demo reset, which clears everyone — so the
 * scope is required to be explicit rather than inferred from a body that may
 * not have survived the page closing.
 */
export async function DELETE(request: Request): Promise<Response> {
  const sourceId = new URL(request.url).searchParams.get("sourceId");

  if (sourceId === null) {
    await clearPositions();
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  }

  if (!isValidToken(sourceId)) {
    return Response.json(
      { error: "invalid-source" },
      { status: 422, headers: { "Cache-Control": "no-store" } },
    );
  }

  if (!isPositionStoreConfigured()) {
    // Nowhere to withdraw from is not a failure to withdraw: the caller wanted
    // this unit gone, and it is.
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  }

  await removePosition(sourceId);
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
