import { del, get, list, put } from "@vercel/blob";

import {
  SIGNAL_TTL_MS,
  isForReader,
  messagePath,
  newNonce,
  parseMessagePath,
  sourcePrefix,
  type SignalMessage,
  type SignalPage,
  type SignalPost,
} from "./signal";

/**
 * Where the handshake waits while the other browser is looking.
 *
 * A Map in the server's memory works right up until the offer lands in one
 * instance and the publisher polls another, and then two browsers on the same
 * table can never find each other. Blob storage is the shared thing every
 * instance can agree on.
 *
 * One object per message and nothing rewritten, so there is no compare-and-set
 * to lose: see `messagePath` for what that cost the version before this one.
 * A reader pays one listing per poll and only fetches the bodies addressed to
 * it, which for everyone not mid-handshake is none of them.
 *
 * Nothing here is durable and nothing is meant to be. A mailbox holds seconds
 * of handshake and then expires; it is not a record that a call happened.
 */

/** Enough for a few peers mid-handshake; the rest have expired. */
const MAX_LISTED = 200;

/** Listing on every write would double the cost of a handshake. */
const PRUNE_ODDS = 1 / 8;

const WRITE = {
  access: "private",
  contentType: "application/json",
  addRandomSuffix: false,
  // The pathname carries a nonce, so this never overwrites another message.
  // It is set because two posts in the same millisecond are not worth a 409.
  allowOverwrite: true,
} as const;

/**
 * Posts one message and returns it as the server recorded it.
 *
 * The sender names itself and its addressee; the clock and the ordering stay
 * here, so a browser cannot backdate a message or claim a place in the queue.
 */
export async function postSignal(
  sourceId: string,
  post: SignalPost,
  now: number = Date.now(),
): Promise<SignalMessage> {
  const nonce = newNonce();
  const message: SignalMessage = {
    ...post,
    at: now,
    cursor: `${String(now).padStart(13, "0")}-${nonce}`,
  };

  await put(messagePath(sourceId, now, nonce, post.to), JSON.stringify(message), WRITE);

  if (Math.random() < PRUNE_ODDS) {
    await pruneSignals(sourceId, now).catch(() => undefined);
  }

  return message;
}

/**
 * Everything this reader has not seen and might act on, and where to resume.
 *
 * The cursor advances past messages that were never fetched — one addressed
 * to somebody else is not one this reader is waiting for, and carrying it
 * forward would only make every poll re-examine it.
 */
export async function readSignals(
  sourceId: string,
  since: string,
  peerId: string,
  now: number = Date.now(),
): Promise<SignalPage> {
  const { blobs } = await list({ prefix: sourcePrefix(sourceId), limit: MAX_LISTED });
  const earliest = now - SIGNAL_TTL_MS;

  const fresh = blobs
    .map((blob) => ({ blob, name: parseMessagePath(blob.pathname, sourceId) }))
    .filter(
      (entry): entry is { blob: (typeof blobs)[number]; name: NonNullable<typeof entry.name> } =>
        entry.name !== null && entry.name.at >= earliest && entry.name.cursor > since,
    )
    .sort((a, b) => a.name.cursor.localeCompare(b.name.cursor));

  const wanted = fresh.filter((entry) => isForReader(entry.name, peerId));
  const bodies = await Promise.all(
    wanted.map(async (entry) => {
      try {
        const found = await get(entry.blob.pathname, { access: "private", useCache: false });
        if (!found?.stream) return null;
        const parsed: unknown = JSON.parse(await new Response(found.stream).text());
        // The name is the authority on ordering, whatever the body claims.
        return { ...(parsed as SignalMessage), cursor: entry.name.cursor, at: entry.name.at };
      } catch {
        // A message that cannot be read is one the sender will repeat.
        return null;
      }
    }),
  );

  return {
    messages: bodies.filter((message): message is SignalMessage => message !== null),
    // Past everything listed, not just everything fetched.
    cursor: fresh.at(-1)?.name.cursor ?? since,
  };
}

/** Drops what has expired. Live connections do not depend on any of it. */
async function pruneSignals(sourceId: string, now: number): Promise<void> {
  const { blobs } = await list({ prefix: sourcePrefix(sourceId), limit: MAX_LISTED });
  const earliest = now - SIGNAL_TTL_MS;
  const expired = blobs.filter((blob) => {
    const name = parseMessagePath(blob.pathname, sourceId);
    return name === null || name.at < earliest;
  });
  if (expired.length > 0) await del(expired.map((blob) => blob.url));
}
