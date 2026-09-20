import type { IncidentEvent, IncidentOrigin } from "../paw-patrol/incidents";
import type { BusStatus } from "../paw-patrol/useIncidentBus";
import type { BodyRegionId } from "./bodyRegions";

export interface BodyObservation {
  id: string;
  personId: string;
  /** Null means the source did not supply a structured anatomical location. */
  region: BodyRegionId | null;
  title: string;
  detail: string;
  source: string;
  origin: IncidentOrigin;
  at: string;
  /** An uncalibrated source score, never injury probability or certainty. */
  confidence: number | null;
  state: "current" | "stale" | "sample";
}

/** A recent report is not proof that the scene or the person is safe. */
export const BODY_OBSERVATION_FRESH_MS = 60_000;

const OBSERVATION_KINDS = new Set<IncidentEvent["kind"]>(["hazard", "transcript", "mist", "panic"]);

function sourceScore(event: IncidentEvent): number | null {
  // The transcript publisher stores language_probability, not confidence in
  // what was said. Showing it beside anatomy would imply a meaning it lacks.
  if (event.origin !== "model" || event.kind === "transcript") return null;
  const value = event.provenance?.confidence;
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : null;
}

/**
 * Read-only display adapter for the existing person-scoped incident log.
 *
 * This event contract has no structured body-region field. Even when a title
 * mentions an arm, a fall, a weapon, or a high pulse, it does not establish an
 * anatomical finding. Keep received evidence unlocalized instead of guessing.
 * Scene-entry and acknowledgement events are operational actions, not medical
 * observations, and are deliberately excluded.
 */
export function getBodyObservations(
  events: readonly IncidentEvent[],
  personId: string,
  busStatus: BusStatus,
  now: number,
): BodyObservation[] {
  if (!personId.trim() || !Number.isFinite(now)) return [];

  return events
    .filter((event) => {
      if (event.personId !== personId || !OBSERVATION_KINDS.has(event.kind)) return false;
      const recordedAt = Date.parse(event.at);
      // Invalid and future records cannot be advertised as current observations.
      return Number.isFinite(recordedAt) && recordedAt <= now;
    })
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || b.seq - a.seq)
    .map((event) => ({
      id: event.id,
      personId,
      region: null,
      title: event.title,
      detail: event.detail,
      source: event.provenance
        ? `${event.source} · ${event.provenance.provider}/${event.provenance.model}`
        : event.source,
      origin: event.origin,
      at: event.at,
      confidence: sourceScore(event),
      state:
        event.origin === "script"
          ? "sample"
          : busStatus === "live" && now - Date.parse(event.at) <= BODY_OBSERVATION_FRESH_MS
            ? "current"
            : "stale",
    }));
}

/**
 * Opt-in UI fixtures. These are not generated from a selected officer's media,
 * never enter the incident bus, and never authorize treatment or scene entry.
 */
export const DEMO_BODY_OBSERVATIONS: readonly Omit<BodyObservation, "personId" | "at">[] = [
  {
    id: "body-ui-sample-left-arm",
    region: "left-arm",
    title: "Left arm · view obscured",
    detail:
      "UI sample: a sleeve obscures this region. Appearance cannot be assessed; no injury has been identified.",
    source: "Local UI sample · not camera output",
    origin: "script",
    confidence: null,
    state: "sample",
  },
  {
    id: "body-ui-sample-right-leg",
    region: "right-leg",
    title: "Right leg · limited view",
    detail:
      "UI sample: this region is partly outside the frame. The marker demonstrates review navigation, not an injury finding.",
    source: "Local UI sample · not camera output",
    origin: "script",
    confidence: null,
    state: "sample",
  },
];

/** Pure local construction: callers must explicitly opt in to sample display. */
export function makeDemoBodyObservations(personId: string, now: number): BodyObservation[] {
  if (!personId.trim() || !Number.isFinite(now)) return [];
  const date = new Date(now);
  if (!Number.isFinite(date.getTime())) return [];
  const at = date.toISOString();
  return DEMO_BODY_OBSERVATIONS.map((sample) => ({
    ...sample,
    id: `${sample.id}:${personId}`,
    personId,
    at,
  }));
}
