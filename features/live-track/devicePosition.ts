import { isValidToken } from "@/features/camera-triage/frame";

import { classifyFreshness } from "./position";
import type { LiveDevice, LiveFix } from "./types";

/**
 * A position published by a phone instead of by a tracking server.
 *
 * Traccar needs a server every device can reach, which a laptop behind a
 * conference network is not. The capture page is already open on the phone and
 * already carries a unit name, so the browser's own Geolocation API is the
 * shorter path to the same picture: one fix per unit, published on its own
 * interval, read back by every workspace.
 *
 * This is not a track. Only the latest fix per unit is kept, there is no
 * history behind it, and a unit that stops publishing ages out rather than
 * leaving a marker that still looks current.
 */

/** One object holds every unit, so a reader pays a single request. */
export const POSITION_PATH = "positions/live.json";
/** A bound on one demo, not a claim about how many units can exist. */
export const MAX_SOURCES = 12;
/**
 * Past this a fix is dropped rather than shown as "last seen". A position this
 * old is almost always a previous run of the demo, not a unit that went quiet,
 * and resurrecting it would put a grey marker on a street nobody is standing on.
 */
export const DROP_AFTER_MS = 1_800_000;

const MAX_NAME = 60;

export interface PositionSubmission {
  sourceId: string;
  /** What the person typed, for display. `sourceId` is its sanitised form. */
  name: string;
  longitude: number;
  latitude: number;
  accuracyMeters: number | null;
  speedKmh: number | null;
  headingDegrees: number | null;
  /** Device clock at the fix. Shown to a viewer, never used for freshness. */
  fixedAt: string;
}

export interface StoredPosition extends PositionSubmission {
  /**
   * Server clock when the fix arrived, and the only thing freshness is measured
   * against.
   *
   * The Traccar path deliberately ages fixes by the device clock, because
   * Traccar Client buffers while it has no route to the server and flushes
   * minutes later. A browser does the opposite: `watchPosition` fires and the
   * page posts immediately, so receipt time is the honest age — and unlike a
   * phone's clock it cannot be wrong by hours and paint a stale unit green.
   */
  publishedAt: string;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isoOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

/**
 * Reads a published fix at the trust boundary. Rejects rather than repairs: a
 * half-valid position would put a marker somewhere nobody chose.
 */
export function parsePositionSubmission(raw: unknown): PositionSubmission | null {
  if (typeof raw !== "object" || raw === null) return null;
  const body = raw as Record<string, unknown>;

  const sourceId = typeof body.sourceId === "string" ? body.sourceId : "";
  if (!isValidToken(sourceId)) return null;

  const latitude = finiteNumber(body.latitude);
  const longitude = finiteNumber(body.longitude);
  if (latitude === null || longitude === null) return null;
  if (latitude < -90 || latitude > 90) return null;
  if (longitude < -180 || longitude > 180) return null;
  // A device that has never held a fix reports exactly 0,0 in the Gulf of Guinea.
  if (latitude === 0 && longitude === 0) return null;

  const fixedAt = isoOrNull(body.fixedAt);
  if (!fixedAt) return null;

  const rawName = typeof body.name === "string" ? body.name.trim() : "";
  const accuracy = finiteNumber(body.accuracyMeters);
  const speed = finiteNumber(body.speedKmh);
  const heading = finiteNumber(body.headingDegrees);

  return {
    sourceId,
    name: rawName ? rawName.slice(0, MAX_NAME) : sourceId,
    longitude,
    latitude,
    accuracyMeters: accuracy !== null && accuracy >= 0 ? accuracy : null,
    speedKmh: speed !== null && speed >= 0 ? speed : null,
    headingDegrees: heading !== null && heading >= 0 && heading <= 360 ? heading : null,
    fixedAt,
  };
}

/** Stamps the server clock on an accepted fix. */
export function storePosition(
  submission: PositionSubmission,
  now: Date = new Date(),
): StoredPosition {
  return { ...submission, publishedAt: now.toISOString() };
}

export function positionAgeSeconds(stored: StoredPosition, nowMs: number): number {
  const published = Date.parse(stored.publishedAt);
  if (Number.isNaN(published)) return Number.POSITIVE_INFINITY;
  // A server clock that stepped backwards must never read as a fix from the future.
  return Math.max(0, Math.round((nowMs - published) / 1000));
}

/**
 * Replaces this unit's fix and leaves every other one alone. One object per
 * unit, overwritten in place: the wall wants where someone is, not where they
 * have been.
 */
export function mergePosition(
  existing: readonly StoredPosition[],
  next: StoredPosition,
): StoredPosition[] {
  const others = existing.filter((position) => position.sourceId !== next.sourceId);
  return [...others, next]
    .sort((a, b) => a.sourceId.localeCompare(b.sourceId))
    .slice(0, MAX_SOURCES);
}

/** Drops fixes too old to describe anywhere a unit currently is. */
export function activePositions(
  positions: readonly StoredPosition[],
  nowMs: number,
): StoredPosition[] {
  return positions.filter((position) => positionAgeSeconds(position, nowMs) * 1000 <= DROP_AFTER_MS);
}

export function toLiveFix(stored: StoredPosition, nowMs: number): LiveFix {
  const ageSeconds = positionAgeSeconds(stored, nowMs);
  return {
    longitude: stored.longitude,
    latitude: stored.latitude,
    accuracyMeters: stored.accuracyMeters,
    speedKmh: stored.speedKmh,
    headingDegrees: stored.headingDegrees,
    fixedAt: stored.fixedAt,
    ageSeconds,
    freshness: classifyFreshness(ageSeconds),
  };
}

/**
 * The view model every workspace already knows how to draw. A phone is only
 * ever "online" while its fix is still live — there is no separate channel
 * here that could be up while the positions are hours old.
 */
export function toLiveDevice(stored: StoredPosition, nowMs: number): LiveDevice {
  const fix = toLiveFix(stored, nowMs);
  return {
    id: stored.sourceId,
    name: stored.name,
    online: fix.freshness === "live",
    fix,
  };
}
