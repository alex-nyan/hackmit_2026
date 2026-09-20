import { parseIncidentDraft, type IncidentEvent } from "@/features/paw-patrol/incidents";
import { SSE_HEADERS, SSE_PRELUDE } from "@/features/streaming/sse";

/**
 * The one piece of state the three workspaces share.
 *
 * This is deliberately in-memory and single-process: it makes Dispatch, Officer
 * and Hospital a single incident instead of three independent simulations, and
 * it is not a database. Run one server (leave `PAW_PATROL_WORKSPACE` unset and
 * open the workspaces as separate windows). Three `next dev` processes on three
 * ports each get their own heap, and each would see only its own events.
 *
 * Nothing here is durable. A restart is a new incident, which is the correct
 * behaviour for a demonstration and the wrong behaviour for a real one.
 */

export const dynamic = "force-dynamic";

const MAX_RETAINED = 200;
const HEARTBEAT_MS = 15_000;
const MAX_BODY_BYTES = 16_384;

interface Subscriber {
  enqueue: (chunk: string) => void;
  close: () => void;
}

const log: IncidentEvent[] = [];
const subscribers = new Set<Subscriber>();
let seq = 0;

function frame(event: IncidentEvent): string {
  return `id: ${event.seq}\nevent: incident\ndata: ${JSON.stringify(event)}\n\n`;
}

function broadcast(event: IncidentEvent): void {
  for (const subscriber of subscribers) {
    try {
      subscriber.enqueue(frame(event));
    } catch {
      // A closed stream is removed by its own abort handler; a failed write
      // here must not stop delivery to the remaining workspaces.
      subscribers.delete(subscriber);
    }
  }
}

/** Replay is by sequence, so a reconnecting workspace never misses an event. */
function backlogAfter(lastSeq: number): IncidentEvent[] {
  return log.filter((event) => event.seq > lastSeq);
}

function parseLastEventId(value: string | null): number {
  if (!value) return 0;
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const fromHeader = parseLastEventId(request.headers.get("last-event-id"));
  const fromQuery = parseLastEventId(url.searchParams.get("since"));
  const since = Math.max(fromHeader, fromQuery);

  const encoder = new TextEncoder();
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let subscriber: Subscriber | undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let open = true;
      const send = (chunk: string) => {
        if (!open) return;
        controller.enqueue(encoder.encode(chunk));
      };

      subscriber = {
        enqueue: send,
        close: () => {
          if (!open) return;
          open = false;
          try {
            controller.close();
          } catch {
            // Already closed by the runtime when the client went away.
          }
        },
      };

      // Prelude first, then everything the subscriber has not already seen.
      send(SSE_PRELUDE);
      for (const event of backlogAfter(since)) send(frame(event));

      subscribers.add(subscriber);
      heartbeat = setInterval(() => send(`: keepalive\n\n`), HEARTBEAT_MS);

      request.signal.addEventListener("abort", () => {
        if (heartbeat) clearInterval(heartbeat);
        if (subscriber) subscribers.delete(subscriber);
        subscriber?.close();
      });
    },
    cancel() {
      if (heartbeat) clearInterval(heartbeat);
      if (subscriber) subscribers.delete(subscriber);
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}

export async function POST(request: Request): Promise<Response> {
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

  const draft = parseIncidentDraft(body);
  if (!draft) {
    return Response.json(
      { error: "invalid-incident" },
      { status: 422, headers: { "Cache-Control": "no-store" } },
    );
  }

  // The client proposes an id; the server owns ordering and the wall clock so a
  // workspace cannot backdate an event or claim a position in the timeline.
  const event: IncidentEvent = { ...draft, seq: ++seq, at: new Date().toISOString() };

  log.push(event);
  if (log.length > MAX_RETAINED) log.splice(0, log.length - MAX_RETAINED);
  broadcast(event);

  return Response.json(event, { status: 201, headers: { "Cache-Control": "no-store" } });
}

/** Demo reset. Clears the shared log and tells every workspace to do the same. */
export async function DELETE(): Promise<Response> {
  log.length = 0;
  for (const subscriber of subscribers) {
    try {
      subscriber.enqueue(`event: reset\ndata: {}\n\n`);
    } catch {
      subscribers.delete(subscriber);
    }
  }
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
