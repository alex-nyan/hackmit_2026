import { BlobPreconditionFailedError, del, get, put } from "@vercel/blob";

import {
  POSITION_PATH,
  activePositions,
  mergePosition,
  storePosition,
  toLiveDevice,
  type PositionSubmission,
  type StoredPosition,
} from "./devicePosition";
import type { LiveDevice } from "./types";

/**
 * Where published positions actually live.
 *
 * The body camera wall learned this the hard way: a Map in the server's memory
 * works until requests are answered by whichever instance is free, and then a
 * phone's fix lands in one heap while the dispatcher reads another. Blob
 * storage is the shared thing every instance can agree on.
 *
 * Every unit sits in one small JSON object rather than one object per unit, so
 * a dashboard poll costs a single request no matter how many people are out
 * there. Appending is a read-modify-write guarded by the object's ETag, which
 * is what keeps two phones publishing at the same moment from erasing each
 * other.
 */

/** Contention here is two phones on a five-second timer, not a write storm. */
const MAX_ATTEMPTS = 5;
const BACKOFF_MS = 60;

type Sleep = (ms: number) => Promise<void>;
const realSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function isWriteConflict(error: unknown): boolean {
  if (error instanceof BlobPreconditionFailedError) return true;
  if (!(error instanceof Error)) return false;
  return /precondition|etag|already exists|conflict/i.test(`${error.name} ${error.message}`);
}

interface StoredPositions {
  positions: StoredPosition[];
  etag: string | null;
}

async function readPositions(): Promise<StoredPositions> {
  // The pathname never changes, so a cached copy would be the previous state.
  const found = await get(POSITION_PATH, { access: "private", useCache: false });
  if (!found?.stream) return { positions: [], etag: null };

  try {
    const parsed: unknown = JSON.parse(await new Response(found.stream).text());
    return {
      positions: Array.isArray(parsed) ? (parsed as StoredPosition[]) : [],
      etag: found.blob.etag,
    };
  } catch {
    // An unreadable object is worse than an empty one only if it also blocks
    // every future write, so it is replaced rather than retried forever.
    return { positions: [], etag: found.blob.etag };
  }
}

/**
 * Publishes one unit's latest fix and returns it as the store recorded it.
 *
 * The phone proposes where it is; the wall clock stays here, so a device with a
 * wrong clock cannot make a stale fix look current to everyone watching.
 */
export async function publishPosition(
  submission: PositionSubmission,
  now: Date = new Date(),
  sleep: Sleep = realSleep,
): Promise<StoredPosition> {
  const stored = storePosition(submission, now);

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const { positions, etag } = await readPositions();
    // Expired units are dropped on the way past rather than in a sweep of their
    // own: every publish already pays for the read.
    const next = mergePosition(activePositions(positions, now.getTime()), stored);

    try {
      await put(POSITION_PATH, JSON.stringify(next), {
        access: "private",
        contentType: "application/json",
        addRandomSuffix: false,
        // A matching ETag is the whole guarantee: if another phone published
        // while this one was reading, the write is refused and read again.
        ...(etag ? { ifMatch: etag } : { allowOverwrite: false }),
      });
      return stored;
    } catch (error) {
      // Losing a race is expected and is retried against the store as it now
      // stands; anything else is a real failure and belongs to the caller.
      if (!isWriteConflict(error) || attempt === MAX_ATTEMPTS - 1) throw error;
      // Retrying immediately just reproduces the collision: every loser reads
      // and writes in lockstep. A short random wait lets the winner commit.
      await sleep(BACKOFF_MS * (attempt + 1) * (0.5 + Math.random() / 2));
    }
  }

  throw new Error("The position could not be published.");
}

/** Every unit currently publishing, as the view model the map already draws. */
export async function listPublishedDevices(nowMs: number = Date.now()): Promise<LiveDevice[]> {
  const { positions } = await readPositions();
  return activePositions(positions, nowMs).map((position) => toLiveDevice(position, nowMs));
}

/** Demo reset, paired with the wall's and the incident log's. */
export async function clearPositions(): Promise<void> {
  await del(POSITION_PATH).catch(() => undefined);
}

/**
 * Whether this deployment has anywhere to put a fix.
 *
 * Without a Blob token a phone's publish would fail on every attempt, and the
 * dashboard should say tracking is unconfigured rather than show an empty list
 * that looks like nobody is out there.
 */
export function isPositionStoreConfigured(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return Boolean(env.BLOB_READ_WRITE_TOKEN?.trim());
}
