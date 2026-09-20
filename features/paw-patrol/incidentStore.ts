import { BlobPreconditionFailedError, del, get, put } from "@vercel/blob";

import type { IncidentDraft, IncidentEvent } from "./incidents";

/**
 * Where the shared incident log actually lives.
 *
 * This was a module-level array, which held up for exactly as long as the
 * three workspaces shared one process. Answer requests from whichever
 * instance is free and the array becomes per-instance: Officer's panic lands
 * in one, Command subscribes to another, and the demo's whole claim — one
 * incident, three workspaces — quietly stops being true.
 *
 * The log is one small JSON object rather than one object per event, so a
 * reader pays a single request. Appending is a read-modify-write guarded by
 * the object's ETag, which is what keeps two simultaneous publishers from
 * overwriting each other.
 *
 * Still nothing durable: a reset empties it, and it is not evidence.
 */

const LOG_PATH = "incidents/log.json";
/** Matches the old in-memory cap: enough to replay a demo, not a database. */
const MAX_RETAINED = 200;
/**
 * Enough attempts to survive a scripted burst, not just a button press.
 *
 * Every publisher reads and rewrites the same object, so simultaneous
 * publishes serialise through this retry rather than through a lock. The
 * budget is what decides whether the unluckiest one lands or is dropped.
 */
const MAX_ATTEMPTS = 10;
/** Spread retries out rather than replaying the same collision. */
const BACKOFF_MS = 150;

/** Injectable so tests do not pay for the waits. */
export type Sleep = (ms: number) => Promise<void>;
const realSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Whether a failed write means somebody else got there first.
 *
 * `instanceof` alone is not enough: the SDK raises the rejection through its
 * own retry wrapper, and the error arriving here is not always the same class
 * object this module imported. The store still names the condition plainly,
 * so the text is the more reliable signal. A creation race reports a blob
 * that already exists rather than a mismatched ETag.
 */
function isWriteConflict(error: unknown): boolean {
  if (error instanceof BlobPreconditionFailedError) return true;
  if (!(error instanceof Error)) return false;
  return /precondition|etag|already exists|conflict/i.test(`${error.name} ${error.message}`);
}

interface StoredLog {
  events: IncidentEvent[];
  etag: string | null;
}

async function readLog(): Promise<StoredLog> {
  // The pathname never changes, so a cached copy would be the previous state.
  const found = await get(LOG_PATH, { access: "private", useCache: false });
  if (!found?.stream) return { events: [], etag: null };

  try {
    const parsed: unknown = JSON.parse(await new Response(found.stream).text());
    return {
      events: Array.isArray(parsed) ? (parsed as IncidentEvent[]) : [],
      etag: found.blob.etag,
    };
  } catch {
    // An unreadable log is worse than an empty one only if it also blocks
    // every future append, so it is replaced rather than retried forever.
    return { events: [], etag: found.blob.etag };
  }
}

/**
 * Appends one event and returns it as the server recorded it.
 *
 * The client proposes an id; ordering and the wall clock stay here, so a
 * workspace cannot backdate an event or claim a position in the timeline.
 */
export async function appendIncident(
  draft: IncidentDraft,
  now: Date = new Date(),
  sleep: Sleep = realSleep,
): Promise<IncidentEvent> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const { events, etag } = await readLog();
    const event: IncidentEvent = {
      ...draft,
      seq: (events.at(-1)?.seq ?? 0) + 1,
      at: now.toISOString(),
    };
    const next = [...events, event].slice(-MAX_RETAINED);

    try {
      await put(LOG_PATH, JSON.stringify(next), {
        access: "private",
        contentType: "application/json",
        addRandomSuffix: false,
        // A matching ETag is the whole guarantee: if someone appended while
        // this one was reading, the write is refused and read again.
        ...(etag ? { ifMatch: etag } : { allowOverwrite: false }),
      });
      return event;
    } catch (error) {
      // Losing a race is expected and is retried against the log as it now
      // stands; anything else is a real failure and belongs to the caller.
      if (!isWriteConflict(error) || attempt === MAX_ATTEMPTS - 1) throw error;
      // Retrying immediately just reproduces the collision: every loser reads
      // and writes in lockstep with every other loser. A short random wait
      // lets the winner commit and spreads the rest out.
      await sleep(BACKOFF_MS * (attempt + 1) * (0.5 + Math.random() / 2));
    }
  }

  throw new Error("The incident log could not be appended to.");
}

/** Everything a workspace has not already seen, by sequence. */
export async function readIncidents(since: number): Promise<IncidentEvent[]> {
  const { events } = await readLog();
  return events.filter((event) => event.seq > since);
}

/** Demo reset. Clears the log for every workspace at once. */
export async function clearIncidents(): Promise<void> {
  try {
    await del(LOG_PATH);
  } catch (error) {
    // An already-absent object is a completed reset, unlike denied access,
    // a suspended/missing store, or a network failure. Do not report those as success.
    if (
      error instanceof Error &&
      (error.message === "not found" ||
        /^Vercel Blob: The requested blob does not exist\.?$/.test(error.message))
    )
      return;
    throw error;
  }
}
