import { MAX_IMAGE_BASE64, isValidToken } from "@/features/camera-triage/frame";

/**
 * The body camera wall.
 *
 * Every capture page already posts a frame to `/api/triage` every couple of
 * seconds. These are those frames, held just long enough for the other
 * workspaces to see them: the latest one per officer and nothing behind it.
 * There is no recording, no history and no durability here, and a source that
 * stops publishing disappears rather than lingering as a still that looks
 * live. A dispatcher must never mistake the last frame before a phone died
 * for the current view from a scene.
 */

export const MEDIA_TYPE = "image/jpeg";

/** Canvas emits standard base64; anything else did not come from a capture. */
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

export interface BodyCamFrame {
  sourceId: string;
  at: string;
  base64: string;
}

export interface FrameSummary {
  sourceId: string;
  /**
   * When the store accepted the frame. This is also the image's cache key: a
   * new timestamp is a new URL, so a watcher refetches exactly when there is
   * something new to fetch.
   */
  at: string;
  bytes: number;
}

export interface FrameSubmission {
  sourceId: string;
  base64: string;
  capturedAt: string | null;
}

function isoOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : value;
}

/**
 * Reads a triage request body as a wall submission.
 *
 * This is the same payload the triage service receives, which is the whole
 * point: the phone uploads one frame and both readers are served from it.
 * Officers on a wall are not paying a second upload for the privilege.
 */
export function parseFrameSubmission(raw: unknown): FrameSubmission | null {
  if (typeof raw !== "object" || raw === null) return null;
  const body = raw as Record<string, unknown>;

  const sourceId = typeof body.source_id === "string" ? body.source_id : "";
  const base64 = typeof body.image_base64 === "string" ? body.image_base64 : "";
  if (!isValidToken(sourceId)) return null;
  if (body.media_type !== MEDIA_TYPE) return null;
  if (!base64 || base64.length > MAX_IMAGE_BASE64 || !BASE64.test(base64)) return null;

  return { sourceId, base64, capturedAt: isoOrNull(body.captured_at) };
}

/** Base64 spends four characters on every three bytes, less the padding. */
export function jpegBytes(base64: string): number {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

/** One blob per officer, named after them so a new frame replaces the old. */
const PREFIX = "frames/";

export function framePath(sourceId: string): string {
  return `${PREFIX}${sourceId}.jpg`;
}

export function sourceIdFromPath(pathname: string): string | null {
  if (!pathname.startsWith(PREFIX) || !pathname.endsWith(".jpg")) return null;
  const sourceId = pathname.slice(PREFIX.length, -".jpg".length);
  return isValidToken(sourceId) ? sourceId : null;
}

export const FRAME_PREFIX = PREFIX;

export function ageMs(frame: { at: string }, nowMs: number): number {
  const at = Date.parse(frame.at);
  return Number.isNaN(at) ? Number.POSITIVE_INFINITY : Math.max(0, nowMs - at);
}

/** A frame this old no longer describes what an officer is looking at. */
export function isStale(at: string, nowMs: number, maxAgeMs: number): boolean {
  return ageMs({ at }, nowMs) > maxAgeMs;
}

/**
 * Decoded with `atob` rather than `Buffer` so this module stays isomorphic.
 * The buffer is named concretely because a `Response` will not accept bytes
 * that might be backed by shared memory.
 */
export function decodeFrame(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
