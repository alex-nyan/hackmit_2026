import { del, get, list, put } from "@vercel/blob";

import {
  FRAME_PREFIX,
  MEDIA_TYPE,
  atFromHistoryPath,
  decodeFrame,
  framePath,
  historyPath,
  historyPrefix,
  isStale,
  sourceIdFromPath,
  type FrameSubmission,
  type FrameSummary,
} from "./frames";

/**
 * Where the wall actually lives.
 *
 * This used to be a Map in the server's memory, which worked because one
 * server meant one heap. On a platform that answers each request from
 * whichever instance is free, that assumption quietly breaks: the phone's
 * frame lands in one instance and the dispatcher's request is served by
 * another, which has never seen it. Blob storage is the shared thing every
 * instance can agree on.
 *
 * Still no recording and no history: one object per officer, overwritten in
 * place, ignored once it goes stale. A frame that stops arriving disappears
 * from the wall rather than lingering as a still that looks live.
 */

/** Past this, a frame is no longer a fair picture of what an officer sees. */
export const STALE_AFTER_MS = 20_000;
/** A bound on what one wall will render, not a policy about how many officers exist. */
export const MAX_SOURCES = 12;
/**
 * How far back review can go.
 *
 * This is the one place the wall stops being amnesiac, so the window is
 * stated rather than implied: everything older is deleted, and nothing here
 * is evidence or a substitute for a real retention policy.
 */
export const HISTORY_WINDOW_MS = 15 * 60_000;
/** Pruning on every frame would cost a listing per publish. */
const PRUNE_ODDS = 1 / 20;

export async function publishFrame(
  submission: FrameSubmission,
  now: Date = new Date(),
): Promise<FrameSummary> {
  const bytes = decodeFrame(submission.base64);
  // put wants a Blob, Buffer or stream rather than a raw byte array.
  const body = new Blob([bytes], { type: MEDIA_TYPE });
  const options = {
    access: "private",
    contentType: MEDIA_TYPE,
    addRandomSuffix: false,
    allowOverwrite: true,
  } as const;

  // The wall's object and the archive's are written together, so a reviewer
  // never sees a gap where the live tile had a frame and history did not.
  await Promise.all([
    put(framePath(submission.sourceId), body, options),
    put(historyPath(submission.sourceId, now.getTime()), body, options),
  ]);

  if (Math.random() < PRUNE_ODDS) {
    await pruneHistory(submission.sourceId, now.getTime()).catch(() => undefined);
  }

  return { sourceId: submission.sourceId, at: now.toISOString(), bytes: bytes.byteLength };
}

/** Everything this officer published inside the review window, oldest first. */
export async function listHistory(sourceId: string, nowMs: number = Date.now()): Promise<number[]> {
  const { blobs } = await list({ prefix: historyPrefix(sourceId), limit: 1000 });
  const earliest = nowMs - HISTORY_WINDOW_MS;
  return blobs
    .map((blob) => atFromHistoryPath(blob.pathname, sourceId))
    .filter((at): at is number => at !== null && at >= earliest)
    .sort((a, b) => a - b);
}

/** One frame from the archive, by the moment it was published. */
export async function readFrameAt(sourceId: string, atMs: number): Promise<ReadableStream | null> {
  const found = await get(historyPath(sourceId, atMs), { access: "private", useCache: false });
  return found?.stream ?? null;
}

async function pruneHistory(sourceId: string, nowMs: number): Promise<void> {
  const { blobs } = await list({ prefix: historyPrefix(sourceId), limit: 1000 });
  const earliest = nowMs - HISTORY_WINDOW_MS;
  const expired = blobs.filter((blob) => {
    const at = atFromHistoryPath(blob.pathname, sourceId);
    return at === null || at < earliest;
  });
  if (expired.length > 0) await del(expired.map((blob) => blob.url));
}

export async function listFrames(nowMs: number = Date.now()): Promise<FrameSummary[]> {
  // A generous limit: stale objects are still listed until something
  // overwrites them, and they must not crowd out live officers.
  const { blobs } = await list({ prefix: FRAME_PREFIX, limit: MAX_SOURCES * 8 });

  return blobs
    .map((blob) => ({
      sourceId: sourceIdFromPath(blob.pathname),
      at: blob.uploadedAt.toISOString(),
      bytes: blob.size,
    }))
    .filter(
      (frame): frame is FrameSummary =>
        frame.sourceId !== null && !isStale(frame.at, nowMs, STALE_AFTER_MS),
    )
    .sort((a, b) => a.sourceId.localeCompare(b.sourceId))
    .slice(0, MAX_SOURCES);
}

/**
 * The bytes, for the one route that serves an image to a watcher.
 *
 * The store is private, so this reads it server-side rather than handing out
 * a URL: a body camera frame should not become a link that outlives the
 * moment. `useCache: false` because the pathname never changes and a cached
 * copy would be the previous officer's view.
 */
export async function readFrame(
  sourceId: string,
  nowMs: number = Date.now(),
): Promise<ReadableStream | null> {
  const found = await get(framePath(sourceId), { access: "private", useCache: false });
  if (!found?.stream) return null;
  if (isStale(found.blob.uploadedAt.toISOString(), nowMs, STALE_AFTER_MS)) return null;
  return found.stream;
}

/** Demo reset, paired with the incident log's own. */
export async function clearWall(): Promise<void> {
  const [latest, archived] = await Promise.all([
    list({ prefix: FRAME_PREFIX, limit: 1000 }),
    list({ prefix: "history/", limit: 1000 }),
  ]);
  const urls = [...latest.blobs, ...archived.blobs].map((blob) => blob.url);
  if (urls.length === 0) return;
  await del(urls);
}
