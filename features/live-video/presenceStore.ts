import { del, list, put } from "@vercel/blob";

import {
  PRESENCE_PREFIX,
  PUBLISHER_TTL_MS,
  parsePresencePath,
  presencePath,
  type PresencePost,
  type PublisherPresence,
} from "./presence";

/** Stop markers outlive any bounded request that was already in flight. */
const RETENTION_MS = 2 * 60_000;
const MAX_LISTED = 1000;
const MAX_PAGES = 4;
const MAX_PUBLISHERS = 12;
const WRITE = {
  access: "private",
  contentType: "application/json",
  addRandomSuffix: false,
  allowOverwrite: true,
} as const;

/** Each capture session owns its own key; an old stop cannot delete a restart. */
export async function publishPresence(sourceId: string, post: PresencePost): Promise<void> {
  await put(
    presencePath(sourceId, post.sessionId, !post.active),
    JSON.stringify({ active: post.active }),
    { ...WRITE, abortSignal: AbortSignal.timeout(8_000) },
  );
}

export async function listPublishers(now = Date.now()): Promise<PublisherPresence[]> {
  const abortSignal = AbortSignal.timeout(6_000);
  const entries: Array<{
    pathname: string;
    url: string;
    uploadedAt: Date;
  }> = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = await list({ prefix: PRESENCE_PREFIX, limit: MAX_LISTED, cursor, abortSignal });
    entries.push(...result.blobs);
    if (!result.hasMore) break;
    cursor = result.cursor;
  }

  const parsed = entries.map((blob) => ({ blob, name: parsePresencePath(blob.pathname) }));
  const stopped = new Set(
    parsed
      .filter(({ name }) => name?.stopped)
      .map(({ name }) => `${name!.sourceId}/${name!.sessionId}`),
  );
  const latest = new Map<string, PublisherPresence>();
  for (const { blob, name } of parsed) {
    if (
      !name ||
      name.stopped ||
      stopped.has(`${name.sourceId}/${name.sessionId}`) ||
      now - blob.uploadedAt.getTime() > PUBLISHER_TTL_MS
    ) {
      continue;
    }
    const presence = {
      sourceId: name.sourceId,
      sessionId: name.sessionId,
      at: blob.uploadedAt.toISOString(),
    };
    if (!latest.has(name.sourceId) || latest.get(name.sourceId)!.at < presence.at) {
      latest.set(name.sourceId, presence);
    }
  }

  // Prune the bounded listing even when no publishers remain. A failed prune
  // cannot change the lease calculation or discard an otherwise valid roster.
  const expired = parsed.filter(({ blob }) => now - blob.uploadedAt.getTime() > RETENTION_MS);
  if (expired.length) {
    await del(
      expired.map(({ blob }) => blob.url),
      { abortSignal },
    ).catch(() => undefined);
  }

  return [...latest.values()]
    .sort((a, b) => a.sourceId.localeCompare(b.sourceId))
    .slice(0, MAX_PUBLISHERS);
}
