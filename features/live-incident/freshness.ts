import type { AlertEvent, Observation, SourceState } from "../../shared/contracts";

/** Advance from the server snapshot clock, not the browser's wall-clock setting. */
export function effectiveFreshness(
  value: Pick<Observation | AlertEvent, "freshness" | "freshness_expires_at">,
  connected: boolean,
  serverNow: number,
) {
  if (value.freshness === "historical") return "historical";
  if (
    !connected ||
    value.freshness !== "fresh" ||
    !value.freshness_expires_at ||
    Date.parse(value.freshness_expires_at) <= serverNow
  )
    return "stale";
  return "fresh";
}

export function sourceAvailability(source: SourceState, connected: boolean, serverNow: number) {
  if (!connected) return "stale";
  if (source.availability !== "available") return source.availability;
  if (!source.freshness_expires_at) return "unknown";
  return Date.parse(source.freshness_expires_at) <= serverNow ? "stale" : "available";
}
