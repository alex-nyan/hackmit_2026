/**
 * Reported persons of interest, drawn in red on every workspace's map.
 *
 * "Suspect" is this demo's shorthand for a *report*, never a finding. Nothing
 * here identifies anyone: the track below is an invented movement attached to
 * one scripted camera signal, and every label the map renders says as much.
 *
 * Provenance: the path is a hand-authored subset of road geometry already
 * cached in `vehicles/street-routes.json` — the eastbound Main Street vertices
 * of `p-03-response`, reversed, starting at the scripted incident point. No
 * routing request was made for it, and a driving centreline only approximates
 * where a person on foot would go. See docs/paw-patrol/patrol-route-provenance.md.
 */

import {
  headingAtDistance,
  motionAtElapsed,
  pointAtDistance,
  prepareRouteGeometry,
  type VehiclePoint,
} from "./vehicles/vehicleMotion";

export interface SuspectTrack {
  id: string;
  /** What the map draws on the chip. Deliberately not a name. */
  descriptor: string;
  /** Where the report came from, carried so the map never has to guess. */
  source: string;
  /** Scenario second the report first places this person on the map. */
  from: number;
  /** Scenario second movement stops. The last position is held after it. */
  until: number;
  movingLabel: string;
  holdingLabel: string;
  path: readonly VehiclePoint[];
}

export interface SuspectPosition {
  point: VehiclePoint;
  /** Degrees clockwise from geographic north, not screen bearing. */
  heading: number;
  speedMps: number;
  moving: boolean;
}

export const SUSPECTS: readonly SuspectTrack[] = [
  {
    id: "S-01",
    descriptor: "Reported person of interest",
    source: "Scripted camera signal · unverified",
    from: 15,
    until: 45,
    movingLabel: "Moving east on Main Street",
    holdingLabel: "Last reported position",
    // 94 m of Main Street over 30 demo seconds — a run, not a drive.
    path: [
      [-71.090794, 42.362764],
      [-71.09057, 42.362747],
      [-71.090251, 42.362723],
      [-71.090198, 42.362721],
      [-71.090125, 42.362719],
      [-71.090045, 42.362719],
      [-71.089942, 42.362719],
      [-71.089867, 42.362735],
      [-71.089798, 42.362741],
      [-71.089729, 42.362748],
      [-71.089654, 42.362742],
    ],
  },
] as const;

const geometries = new Map(
  SUSPECTS.map((suspect) => [suspect.id, prepareRouteGeometry(suspect.path)]),
);

function track(id: string): SuspectTrack | null {
  return SUSPECTS.find((suspect) => suspect.id === id) ?? null;
}

function clamp(time: number): number {
  return Number.isFinite(time) ? Math.min(90, Math.max(0, time)) : 0;
}

/**
 * Null before the report exists. A reported position that predates its report
 * would be a claim the scenario never made.
 */
export function suspectAt(id: string, time: number): SuspectPosition | null {
  const suspect = track(id);
  const t = clamp(time);
  if (!suspect || t < suspect.from) return null;
  const geometry = geometries.get(suspect.id);
  if (!geometry?.coordinates.length) return null;
  const motion = motionAtElapsed(
    geometry.lengthMeters,
    suspect.until - suspect.from,
    t - suspect.from,
  );
  return {
    point: pointAtDistance(geometry, motion.distance),
    heading: headingAtDistance(geometry, motion.distance),
    speedMps: motion.speedMps,
    moving: t < suspect.until,
  };
}

export function suspectStatus(id: string, time: number): string {
  const suspect = track(id);
  if (!suspect) return "";
  return clamp(time) < suspect.until ? suspect.movingLabel : suspect.holdingLabel;
}

/** The reports the scenario has placed on the map by this second. */
export function reportedSuspects(time: number): SuspectTrack[] {
  const t = clamp(time);
  return SUSPECTS.filter((suspect) => t >= suspect.from);
}
