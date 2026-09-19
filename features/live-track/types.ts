/**
 * A GPS fix is described by the device clock, not by when the server received
 * it. Traccar Client buffers fixes while it has no route to the server and
 * flushes them later, so `serverTime` can trail `deviceTime` by many minutes.
 * Every freshness decision here uses the device fix time.
 */
export const LIVE_FIX_SECONDS = 90;
export const STALE_FIX_SECONDS = 600;

/** How much to trust the last fix as a description of where the device is now. */
export type FixFreshness = "live" | "stale" | "lost";

export interface LiveFix {
  longitude: number;
  latitude: number;
  /** Reported horizontal accuracy in metres, or null when the device omits it. */
  accuracyMeters: number | null;
  speedKmh: number | null;
  headingDegrees: number | null;
  /** ISO 8601 device fix time. */
  fixedAt: string;
  /** Age of the fix, computed on the server when the response is built. */
  ageSeconds: number;
  freshness: FixFreshness;
}

export interface LiveDevice {
  id: number;
  name: string;
  /**
   * Traccar's reachability flag. It tracks when data last arrived, which is not
   * the same as how fresh the position is — a device can be online carrying a
   * fix that is half an hour old.
   */
  online: boolean;
  /** Null when the device has never produced a usable fix. */
  fix: LiveFix | null;
}

export type LiveTrackPayload =
  | { state: "tracking"; devices: LiveDevice[] }
  | { state: "no-devices" }
  | { state: "not-configured" }
  | { state: "unavailable"; reason: string };

/** Client-side view state, including the phases that exist only in the browser. */
export type LiveTrackState = LiveTrackPayload | { state: "idle" } | { state: "connecting" };
