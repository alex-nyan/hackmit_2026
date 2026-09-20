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

/**
 * Whether the store itself has gone away, rather than one write losing a race.
 *
 * A suspended Blob store is a particularly quiet way to break: the API plane
 * keeps answering, so the token still looks valid and `list` still returns the
 * objects, while every read and write on the data plane is refused with a bare
 * 403. Nothing retries its way out of that, and nothing the caller did caused
 * it, so it is worth telling apart from a fix that simply failed to land.
 */
export function isStoreUnavailable(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /store has been suspended|store does not exist|blob service is currently not available|40[13] (Forbidden|Unauthorized)/i.test(
    `${error.name} ${error.message}`,
  );
}

/**
 * Where positions go when the Blob store will not take them.
 *
 * Memory was rejected as the store for exactly the reason it is worth having as
 * a fallback: it belongs to one server instance, so two dashboards can be told
 * different things. That is a bad way to run a deployment and a good way to
 * survive one — a demo whose map goes blank because a storage product was
 * suspended is worse than a map that is occasionally a fix behind.
 *
 * Every reader is told which of the two answered, so the difference shows up on
 * screen instead of being inferred from a map that looks wrong.
 */
let fallbackPositions: StoredPosition[] = [];

/** Which store actually answered. Reported, never guessed at by a caller. */
export type PositionSource = "store" | "memory";

export interface PublishedPositions {
  devices: LiveDevice[];
  source: PositionSource;
}

/** The sentence a dashboard shows when the shared store is not the one answering. */
export const MEMORY_FALLBACK_NOTE =
  "The shared position store is unavailable, so units are being held in this server's memory. They will be visible here but may not reach another instance, and they are lost on redeploy.";

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

  try {
    return await writePosition(stored, now, sleep);
  } catch (error) {
    if (!isStoreUnavailable(error)) throw error;
    // The phone did its part. Holding the fix here keeps it on this instance's
    // map rather than dropping it because a storage product said no.
    fallbackPositions = mergePosition(activePositions(fallbackPositions, now.getTime()), stored);
    return stored;
  }
}

async function writePosition(
  stored: StoredPosition,
  now: Date,
  sleep: Sleep,
): Promise<StoredPosition> {
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

/**
 * Takes one unit off the map now, instead of letting it age out.
 *
 * Ageing out is the right answer for a phone that went quiet: it stopped
 * saying where it was, and grey says exactly that. It is the wrong answer for
 * somebody who pressed stop, because they did not go quiet — they left, and a
 * dispatcher watching a marker fade over the next half hour is reading a unit
 * that is not there.
 *
 * Answers whether there was anything to withdraw, so a caller can tell a
 * removal from a no-op without reading the store again.
 */
export async function removePosition(
  sourceId: string,
  now: Date = new Date(),
  sleep: Sleep = realSleep,
): Promise<boolean> {
  try {
    return await deletePosition(sourceId, now, sleep);
  } catch (error) {
    if (!isStoreUnavailable(error)) throw error;
    const before = fallbackPositions.length;
    fallbackPositions = fallbackPositions.filter((position) => position.sourceId !== sourceId);
    return fallbackPositions.length !== before;
  }
}

async function deletePosition(sourceId: string, now: Date, sleep: Sleep): Promise<boolean> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const { positions, etag } = await readPositions();
    // Nothing of this unit's to remove. Writing anyway would cost a round trip
    // and a lost race for whoever is publishing right now.
    if (!positions.some((position) => position.sourceId === sourceId)) return false;

    const next = activePositions(positions, now.getTime()).filter(
      (position) => position.sourceId !== sourceId,
    );

    try {
      await put(POSITION_PATH, JSON.stringify(next), {
        access: "private",
        contentType: "application/json",
        addRandomSuffix: false,
        ...(etag ? { ifMatch: etag } : { allowOverwrite: false }),
      });
      return true;
    } catch (error) {
      if (!isWriteConflict(error) || attempt === MAX_ATTEMPTS - 1) throw error;
      await sleep(BACKOFF_MS * (attempt + 1) * (0.5 + Math.random() / 2));
    }
  }

  throw new Error("The position could not be withdrawn.");
}

/** Every unit currently publishing, as the view model the map already draws. */
export async function listPublishedDevices(
  nowMs: number = Date.now(),
): Promise<PublishedPositions> {
  try {
    const { positions } = await readPositions();
    return { devices: toDevices(positions, nowMs), source: "store" };
  } catch (error) {
    if (!isStoreUnavailable(error)) throw error;
    // Whatever this instance accepted while the store was refusing. Saying
    // "no units" here would report an outage as an empty street.
    return { devices: toDevices(fallbackPositions, nowMs), source: "memory" };
  }
}

function toDevices(positions: readonly StoredPosition[], nowMs: number): LiveDevice[] {
  return activePositions(positions, nowMs).map((position) => toLiveDevice(position, nowMs));
}

/** Demo reset, paired with the wall's and the incident log's. */
export async function clearPositions(): Promise<void> {
  fallbackPositions = [];
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
