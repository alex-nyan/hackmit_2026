import { appendIncident, clearIncidents, readIncidents } from "@/features/paw-patrol/incidentStore";
import { parseIncidentDraft } from "@/features/paw-patrol/incidents";
import { readFrameBody } from "@/features/camera-triage/readFrameBody";

/**
 * The one piece of state the three workspaces share.
 *
 * Polled by sequence rather than streamed. An event stream is the better
 * shape for a log, but it holds a server instance open for every workspace
 * watching, and on a platform that answers each request from whichever
 * instance is free the subscriber and the publisher are rarely the same one.
 * A cursor gives the same guarantee — a workspace never misses an event —
 * without either problem.
 */

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 16_384;

function parseSince(value: string | null): number {
  if (!value) return 0;
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

export async function GET(request: Request): Promise<Response> {
  const since = parseSince(new URL(request.url).searchParams.get("since"));
  const events = await readIncidents(since);
  return Response.json(
    { events, seq: events.at(-1)?.seq ?? since },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request): Promise<Response> {
  const raw = await readFrameBody(request, MAX_BODY_BYTES);
  if (!raw.ok) {
    return Response.json(
      { error: raw.status === 413 ? "too-large" : raw.error },
      { status: raw.status, headers: { "Cache-Control": "no-store" } },
    );
  }

  let body: unknown;
  try {
    body = JSON.parse(raw.body);
  } catch {
    return Response.json(
      { error: "invalid-json" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const draft = parseIncidentDraft(body);
  if (!draft) {
    return Response.json(
      { error: "invalid-incident" },
      { status: 422, headers: { "Cache-Control": "no-store" } },
    );
  }

  const event = await appendIncident(draft);
  return Response.json(event, { status: 201, headers: { "Cache-Control": "no-store" } });
}

/** Demo reset. Clears the shared log for every workspace. */
export async function DELETE(): Promise<Response> {
  try {
    await clearIncidents();
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json(
      { error: "reset-failed", reason: "The shared incident log could not be cleared." },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
