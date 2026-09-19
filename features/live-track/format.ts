import type { FixFreshness, LiveFix } from "./types";

export function formatAge(seconds: number): string {
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

/** Wording states what the fix can still be trusted to mean. */
export function freshnessLabel(freshness: FixFreshness): string {
  if (freshness === "live") return "Live";
  if (freshness === "stale") return "Stale fix";
  return "No recent fix";
}

export function formatAccuracy(fix: LiveFix): string {
  if (fix.accuracyMeters === null) return "accuracy not reported";
  return `±${Math.round(fix.accuracyMeters)} m`;
}

export function formatSpeed(fix: LiveFix): string | null {
  if (fix.speedKmh === null) return null;
  if (fix.speedKmh < 1) return "stationary";
  return `${fix.speedKmh.toFixed(1)} km/h`;
}

export function formatCoordinates(fix: LiveFix): string {
  return `${fix.latitude.toFixed(5)}, ${fix.longitude.toFixed(5)}`;
}
