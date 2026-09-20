import { isValidToken } from "@/features/camera-triage/frame";

/** Discovery is a lease on a camera, never a claim that video is arriving. */
export const PUBLISHER_TTL_MS = 20_000;
export const PUBLISHER_HEARTBEAT_MS = 5_000;
export const PRESENCE_PREFIX = "publishers/";

export interface PublisherPresence {
  sourceId: string;
  sessionId: string;
  /** Shared storage's clock, not a browser's clock. */
  at: string;
}

export interface PresencePost {
  sessionId: string;
  active: boolean;
}

export function parsePresencePost(value: unknown): PresencePost | null {
  if (!value || typeof value !== "object") return null;
  const body = value as Record<string, unknown>;
  if (typeof body.sessionId !== "string" || !/^[a-zA-Z0-9_-]{8,64}$/.test(body.sessionId)) {
    return null;
  }
  return typeof body.active === "boolean"
    ? { sessionId: body.sessionId, active: body.active }
    : null;
}

export function presencePath(sourceId: string, sessionId: string, stopped = false): string {
  return `${PRESENCE_PREFIX}${sourceId}/${sessionId}.${stopped ? "stopped" : "json"}`;
}

export function parsePresencePath(
  pathname: string,
): { sourceId: string; sessionId: string; stopped: boolean } | null {
  if (!pathname.startsWith(PRESENCE_PREFIX)) return null;
  const [sourceId, name, extra] = pathname.slice(PRESENCE_PREFIX.length).split("/");
  if (!sourceId || !isValidToken(sourceId) || !name || extra !== undefined) return null;
  const match = /^([a-zA-Z0-9_-]{8,64})\.(json|stopped)$/.exec(name);
  return match ? { sourceId, sessionId: match[1], stopped: match[2] === "stopped" } : null;
}
