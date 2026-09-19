import { LIVE_FIX_SECONDS, STALE_FIX_SECONDS, type FixFreshness, type LiveFix } from "./types";

const KNOTS_TO_KMH = 1.852;
const EARTH_RADIUS_M = 6378137;

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Traccar reports speed in knots; the dashboard shows km/h. */
export function knotsToKmh(knots: number): number {
  return knots * KNOTS_TO_KMH;
}

export function classifyFreshness(ageSeconds: number): FixFreshness {
  if (ageSeconds <= LIVE_FIX_SECONDS) return "live";
  if (ageSeconds <= STALE_FIX_SECONDS) return "stale";
  return "lost";
}

/**
 * Validates one Traccar position at the trust boundary and reduces it to the
 * fields the viewer needs. Returns null rather than guessing when the record is
 * unusable, so the dashboard can say "no fix" instead of drawing a wrong point.
 */
export function toLiveFix(raw: unknown, now: Date): LiveFix | null {
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Record<string, unknown>;

  // Traccar marks dead-reckoned or unfixed records invalid; they are not positions.
  if (record.valid === false) return null;

  const latitude = finiteNumber(record.latitude);
  const longitude = finiteNumber(record.longitude);
  if (latitude === null || longitude === null) return null;
  if (latitude < -90 || latitude > 90) return null;
  if (longitude < -180 || longitude > 180) return null;

  // A device that has never had a fix reports exactly 0,0 in the Gulf of Guinea.
  if (latitude === 0 && longitude === 0) return null;

  const fixTimeSource = record.fixTime ?? record.deviceTime;
  if (typeof fixTimeSource !== "string") return null;
  const fixedAtMs = Date.parse(fixTimeSource);
  if (Number.isNaN(fixedAtMs)) return null;

  // Device clocks can run ahead of the server; never report a negative age.
  const ageSeconds = Math.max(0, Math.round((now.getTime() - fixedAtMs) / 1000));

  const accuracy = finiteNumber(record.accuracy);
  const speed = finiteNumber(record.speed);
  const course = finiteNumber(record.course);

  return {
    longitude,
    latitude,
    accuracyMeters: accuracy !== null && accuracy >= 0 ? accuracy : null,
    speedKmh: speed !== null && speed >= 0 ? knotsToKmh(speed) : null,
    headingDegrees: course !== null && course >= 0 && course <= 360 ? course : null,
    fixedAt: new Date(fixedAtMs).toISOString(),
    ageSeconds,
    freshness: classifyFreshness(ageSeconds),
  };
}

/**
 * Picks the newest fix by device time. Traccar's own "latest position" pointer
 * can lag when buffered fixes arrive out of order, so order explicitly here.
 */
export function newestFix(fixes: LiveFix[]): LiveFix | null {
  return fixes.reduce<LiveFix | null>((newest, fix) => {
    if (!newest) return fix;
    return Date.parse(fix.fixedAt) > Date.parse(newest.fixedAt) ? fix : newest;
  }, null);
}

/**
 * Closed geodesic ring approximating the reported accuracy radius, so the map
 * shows real uncertainty rather than a fixed-pixel halo that lies at some zooms.
 */
export function accuracyRing(
  longitude: number,
  latitude: number,
  radiusMeters: number,
  steps = 64,
): [number, number][] {
  const latRad = (latitude * Math.PI) / 180;
  const cosLat = Math.cos(latRad);
  const deltaLat = (radiusMeters / EARTH_RADIUS_M) * (180 / Math.PI);
  // Guard the pole singularity; longitude degrees shrink to nothing there.
  const deltaLon = Math.abs(cosLat) < 1e-9 ? deltaLat : deltaLat / cosLat;

  const ring: [number, number][] = [];
  for (let step = 0; step <= steps; step += 1) {
    const angle = (step / steps) * 2 * Math.PI;
    ring.push([longitude + deltaLon * Math.cos(angle), latitude + deltaLat * Math.sin(angle)]);
  }
  return ring;
}
