import { isValidToken } from "@/features/camera-triage/frame";

/**
 * The few messages two browsers exchange before they can talk directly.
 *
 * Media flows directly between browsers. This mailbox carries descriptions,
 * bounded batches of ICE routes, and departure messages. A new watcher ID is
 * generated for every attempt so late messages cannot affect a later attempt.
 */

/** A page load's name for itself. Never a person, and never reused. */
const PEER_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

/**
 * How long an unanswered message is worth keeping.
 *
 * An offer nobody replies to means the publisher is not there, and a watcher
 * that is still interested will have asked again by now. Holding them longer
 * only makes a publisher that arrives late answer a browser that has moved on.
 */
export const SIGNAL_TTL_MS = 30_000;

/**
 * An SDP carrying its own candidates is a few kilobytes. This is loose enough
 * for a host with many interfaces and tight enough that the mailbox cannot be
 * used as storage.
 */
export const MAX_SDP_CHARS = 64_000;

export const MAX_CANDIDATES_PER_BATCH = 8;
export const MAX_CANDIDATE_CHARS = 2_048;
export const MAX_CANDIDATES_PER_PEER = 64;

export type SignalKind = "offer" | "answer" | "candidates" | "bye";

export interface SignalMessage {
  /**
   * Where this message sits in its mailbox's order, and what a reader advances
   * past. A string rather than a counter because it is the object's own name:
   * see `messagePath` for why the two are the same thing.
   */
  cursor: string;
  /** When the server accepted it, for expiry. Never trusted from a client. */
  at: number;
  kind: SignalKind;
  from: string;
  /** Empty addresses every publisher on the source; an offer has no one yet. */
  to: string;
  sdp?: string;
  candidates?: RTCIceCandidateInit[];
  complete?: boolean;
  /** Monotonic within one sender's ICE exchange; blob visibility may reorder. */
  batch?: number;
}

export type SignalPost = Omit<SignalMessage, "cursor" | "at">;

export interface SignalPage {
  messages: SignalMessage[];
  /** Where the reader should resume. Opaque; only ever compared and echoed. */
  cursor: string;
}

export function newPeerId(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

/** A reader names itself so the store knows which bodies it need not fetch. */
export function isPeerId(value: string): boolean {
  return PEER_PATTERN.test(value);
}

function isKind(value: unknown): value is SignalKind {
  return value === "offer" || value === "answer" || value === "candidates" || value === "bye";
}

export function parseSignalPost(raw: unknown): SignalPost | null {
  if (typeof raw !== "object" || raw === null) return null;
  const body = raw as Record<string, unknown>;

  if (!isKind(body.kind)) return null;
  const from = typeof body.from === "string" ? body.from : "";
  const to = typeof body.to === "string" ? body.to : "";
  if (!PEER_PATTERN.test(from)) return null;
  if (to !== "" && !PEER_PATTERN.test(to)) return null;

  // A farewell carries no description: it exists to make the other side tear
  // down now rather than wait out a timeout.
  if (body.kind === "bye") return { kind: "bye", from, to };

  if (body.kind === "candidates") {
    if (!to || !Array.isArray(body.candidates)) return null;
    if (body.candidates.length > MAX_CANDIDATES_PER_BATCH) return null;
    if (typeof body.complete !== "boolean") return null;
    if (
      typeof body.batch !== "number" ||
      !Number.isInteger(body.batch) ||
      body.batch < 0 ||
      body.batch > MAX_CANDIDATES_PER_PEER
    )
      return null;
    if (body.candidates.length === 0 && !body.complete) return null;
    const candidates: RTCIceCandidateInit[] = [];
    for (const raw of body.candidates) {
      if (typeof raw !== "object" || raw === null) return null;
      const candidate = raw as Record<string, unknown>;
      if (
        typeof candidate.candidate !== "string" ||
        !candidate.candidate ||
        candidate.candidate.length > MAX_CANDIDATE_CHARS ||
        (candidate.sdpMid != null &&
          (typeof candidate.sdpMid !== "string" || candidate.sdpMid.length > 256)) ||
        (candidate.sdpMLineIndex != null &&
          (typeof candidate.sdpMLineIndex !== "number" ||
            !Number.isInteger(candidate.sdpMLineIndex) ||
            candidate.sdpMLineIndex < 0 ||
            candidate.sdpMLineIndex > 64)) ||
        (candidate.usernameFragment != null &&
          (typeof candidate.usernameFragment !== "string" ||
            candidate.usernameFragment.length > 256))
      )
        return null;
      candidates.push({
        candidate: candidate.candidate,
        sdpMid: candidate.sdpMid as string | null | undefined,
        sdpMLineIndex: candidate.sdpMLineIndex as number | null | undefined,
        usernameFragment: candidate.usernameFragment as string | null | undefined,
      });
    }
    return { kind: "candidates", from, to, candidates, complete: body.complete, batch: body.batch };
  }

  const sdp = typeof body.sdp === "string" ? body.sdp : "";
  if (!sdp || sdp.length > MAX_SDP_CHARS) return null;
  return { kind: body.kind, from, to, sdp };
}

/** Mailboxes are named after the source, so they must be named like one. */
export function isSignalSource(sourceId: string): boolean {
  return isValidToken(sourceId);
}

/** A cursor is a pathname this module wrote, or the empty string for "start". */
export function isCursor(value: string): boolean {
  return value === "" || /^\d{13}-[a-z0-9]{8}$/.test(value);
}

/**
 * One object per message, rather than one mailbox object rewritten.
 *
 * The first version of this was a single JSON array appended to under its
 * ETag, exactly like the incident log. It failed in a way the incident log
 * never does: a handshake writes far more often than an incident, and the
 * store's own read-after-write lag meant a writer kept reading an ETag that
 * was already stale, losing its compare-and-set several times in a row and
 * giving up while two browsers waited. There is no shared object to contend
 * over here — every message is its own name, so no write can lose a race it
 * was never in.
 *
 * Timestamps are zero-padded so the store's ordering is time's ordering, and
 * the addressee is in the name so a reader can tell what is worth fetching
 * before it pays to fetch it.
 */
const PREFIX = "signals/";
const STAMP_WIDTH = 13;
const NONCE_WIDTH = 8;
/** Addressed to whoever is publishing, rather than to a named peer. */
const ANYONE = "all";

export function sourcePrefix(sourceId: string): string {
  return `${PREFIX}${sourceId}/`;
}

export function newNonce(): string {
  return Math.random().toString(36).slice(2).padEnd(NONCE_WIDTH, "0").slice(0, NONCE_WIDTH);
}

export function messagePath(sourceId: string, atMs: number, nonce: string, to: string): string {
  const stamp = String(atMs).padStart(STAMP_WIDTH, "0");
  return `${sourcePrefix(sourceId)}${stamp}-${nonce}-${to || ANYONE}.json`;
}

export interface MessageName {
  /** `{stamp}-{nonce}`: fixed width, so comparing strings compares moments. */
  cursor: string;
  at: number;
  to: string;
}

export function parseMessagePath(pathname: string, sourceId: string): MessageName | null {
  const prefix = sourcePrefix(sourceId);
  if (!pathname.startsWith(prefix) || !pathname.endsWith(".json")) return null;

  const name = pathname.slice(prefix.length, -".json".length);
  const stamp = name.slice(0, STAMP_WIDTH);
  if (!/^\d+$/.test(stamp) || name[STAMP_WIDTH] !== "-") return null;

  const nonce = name.slice(STAMP_WIDTH + 1, STAMP_WIDTH + 1 + NONCE_WIDTH);
  if (!/^[a-z0-9]+$/.test(nonce) || name[STAMP_WIDTH + 1 + NONCE_WIDTH] !== "-") return null;

  const to = name.slice(STAMP_WIDTH + 2 + NONCE_WIDTH);
  const at = Number.parseInt(stamp, 10);
  if (!Number.isSafeInteger(at) || at <= 0) return null;

  return { cursor: `${stamp}-${nonce}`, at, to: to === ANYONE ? "" : to };
}

/** Whether a reader with this name should pay to fetch this message. */
export function isForReader(name: MessageName, peerId: string): boolean {
  return name.to === "" || name.to === peerId;
}
