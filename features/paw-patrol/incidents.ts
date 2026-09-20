/**
 * The shared incident record that crosses workspaces.
 *
 * Until now Dispatch, Officer and Hospital each ran their own copy of the
 * scripted scenario, so nothing one workspace did was visible to another. These
 * events are the only shared state, and they are append-only: a workspace
 * publishes what it observed, and every subscriber renders the same log.
 *
 * Provenance is carried on the event rather than reconstructed by the reader.
 * A hazard reported by a model and a report typed by a person must never be
 * indistinguishable once they are side by side in one timeline.
 */

export const INCIDENT_KINDS = [
  "panic",
  "acknowledge",
  "scene",
  "hazard",
  "transcript",
  "mist",
  "vitals",
  "observation",
] as const;
export type IncidentKind = (typeof INCIDENT_KINDS)[number];

/** Who produced the claim. A model is never recorded as an observer. */
export const INCIDENT_ORIGINS = ["model", "operator", "script"] as const;
export type IncidentOrigin = (typeof INCIDENT_ORIGINS)[number];

export interface IncidentProvenance {
  provider: string;
  model: string;
  /** Uncalibrated model score, not a probability. Absent when a person reported. */
  confidence: number | null;
}

export interface IncidentEvent {
  /** Server-assigned. Monotonic within a run; used to resume and to dedupe. */
  seq: number;
  /** Capture/receipt time, distinct from log publication. */
  observedAt?: string;
  id: string;
  kind: IncidentKind;
  origin: IncidentOrigin;
  /** Wall clock at publication. Distinct from the scenario clock below. */
  at: string;
  /** Demo timeline position in seconds, when the publisher was running one. */
  scenarioAt: number | null;
  title: string;
  detail: string;
  source: string;
  personId: string | null;
  provenance: IncidentProvenance | null;
  /** Stated by the producer, never derived by a reader. */
  requiresHumanReview: boolean;
}

/** What a client may publish. The server owns `seq` and `at`. */
export type IncidentDraft = Omit<IncidentEvent, "seq" | "at">;

const MAX_TEXT = 600;
const MAX_ID = 128;

function text(value: unknown, limit = MAX_TEXT): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > limit) return null;
  return trimmed;
}

function optionalText(value: unknown, limit = MAX_TEXT): string | null | undefined {
  if (value === null || value === undefined) return null;
  return text(value, limit) ?? undefined;
}

function provenance(value: unknown): IncidentProvenance | null | undefined {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const provider = text(raw.provider, MAX_ID);
  const model = text(raw.model, MAX_ID);
  if (!provider || !model) return undefined;
  const score = raw.confidence;
  if (score === null || score === undefined) return { provider, model, confidence: null };
  if (typeof score !== "number" || !Number.isFinite(score) || score < 0 || score > 1)
    return undefined;
  return { provider, model, confidence: score };
}

/**
 * Rejects rather than repairs. A malformed event is dropped at the boundary so
 * a reader never has to decide what a partially-valid incident means.
 */
export function parseIncidentDraft(value: unknown): IncidentDraft | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;

  const observedAt = raw.observedAt;
  if (
    observedAt !== undefined &&
    (typeof observedAt !== "string" || !Number.isFinite(Date.parse(observedAt)))
  )
    return null;
  const id = text(raw.id, MAX_ID);
  const title = text(raw.title);
  const detail = text(raw.detail);
  const source = text(raw.source, MAX_ID);
  if (!id || !title || !detail || !source) return null;

  if (!INCIDENT_KINDS.includes(raw.kind as IncidentKind)) return null;
  if (!INCIDENT_ORIGINS.includes(raw.origin as IncidentOrigin)) return null;
  if (typeof raw.requiresHumanReview !== "boolean") return null;

  const personId = optionalText(raw.personId, MAX_ID);
  if (personId === undefined) return null;

  const trace = provenance(raw.provenance);
  if (trace === undefined) return null;

  let scenarioAt: number | null = null;
  if (raw.scenarioAt !== null && raw.scenarioAt !== undefined) {
    const seconds = raw.scenarioAt;
    if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0 || seconds > 86_400)
      return null;
    scenarioAt = seconds;
  }

  // A model-origin event without provenance would be unattributable once it is
  // in the timeline next to a report a person typed.
  if (raw.origin === "model" && !trace) return null;

  return {
    id,
    ...(typeof observedAt === "string" ? { observedAt } : {}),
    kind: raw.kind as IncidentKind,
    origin: raw.origin as IncidentOrigin,
    scenarioAt,
    title,
    detail,
    source,
    personId,
    provenance: trace,
    requiresHumanReview: raw.requiresHumanReview,
  };
}

/** Newest first, with a stable tiebreak so equal timestamps do not reorder. */
export function byNewest(a: IncidentEvent, b: IncidentEvent): number {
  return b.seq - a.seq;
}

export function describeOrigin(event: IncidentEvent): string {
  if (event.origin === "model") return "Model output · unreviewed";
  if (event.origin === "script") return "Scripted scenario";
  return "Reported by a person";
}
