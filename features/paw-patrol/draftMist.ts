import type { IncidentEvent } from "./incidents";

/**
 * Pre-fills the handoff from what the models reported on the way in.
 *
 * This is the "care starts before arrival" claim made literal: by the time the
 * receiving desk opens the case, the camera and microphone evidence gathered at
 * the scene is already laid out in MIST shape. What it must never do is arrive
 * as a finding. A draft is an unconfirmed suggestion that a clinician edits or
 * discards, it is never saved on the model's say-so, and it fills only the
 * fields a model can legitimately speak to.
 *
 * Injuries stay empty on purpose. A weapon in frame is not a wound, a person
 * lying down is not a diagnosis, and no amount of model confidence turns an
 * observation into a clinical finding. Only a person fills that field.
 */

export interface MistDraft {
  /** Suggested text for the mechanism field. Empty when nothing supports one. */
  mechanism: string;
  /** Always empty. Present so callers see the omission is deliberate. */
  injuries: string;
  symptoms: string;
  /** One line per event the draft was built from, for display beside it. */
  basis: string[];
  /** Fixed. A draft is never a record; the type prevents pretending otherwise. */
  confirmed: false;
}

export const EMPTY_DRAFT: MistDraft = {
  mechanism: "",
  injuries: "",
  symptoms: "",
  basis: [],
  confirmed: false,
};

function scenarioStamp(event: IncidentEvent): string {
  if (event.scenarioAt === null) return new Date(event.at).toLocaleTimeString();
  const minutes = Math.floor(event.scenarioAt / 60);
  const seconds = Math.floor(event.scenarioAt % 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function basisLine(event: IncidentEvent): string {
  const model = event.provenance ? `${event.provenance.provider}/${event.provenance.model}` : "—";
  const score =
    event.provenance?.confidence === null || event.provenance?.confidence === undefined
      ? "no score"
      : `score ${event.provenance.confidence.toFixed(2)} (uncalibrated)`;
  return `${scenarioStamp(event)} · ${event.title} · ${model} · ${score}`;
}

/**
 * Builds a draft from the model-origin events for one person. Operator and
 * script events are excluded: those are already recorded elsewhere, and mixing
 * them in would blur which parts of the draft a machine proposed.
 */
export function draftMist(events: IncidentEvent[], personId: string): MistDraft {
  const relevant = events.filter(
    (event) => event.origin === "model" && event.personId === personId,
  );
  if (relevant.length === 0) return EMPTY_DRAFT;

  const hazards = relevant.filter((event) => event.kind === "hazard");
  const transcripts = relevant.filter((event) => event.kind === "transcript");

  const mechanismParts: string[] = [];
  for (const event of hazards) {
    // The event title already carries the "unverified" qualifier.
    mechanismParts.push(`${event.title} (${scenarioStamp(event)})`);
  }

  const mechanism = mechanismParts.length
    ? `Unconfirmed draft from scene camera: ${mechanismParts.join("; ")}. Model observation only — mechanism not established by a person.`
    : "";

  const symptoms = transcripts.length
    ? `Unconfirmed draft from scene audio: ${transcripts
        .map((event) => `${event.detail}`)
        .join(" ")} Not a record of speech; confirm with the crew.`
    : "";

  return {
    mechanism,
    // Deliberately never populated. See the note at the top of this file.
    injuries: "",
    symptoms,
    basis: relevant.map(basisLine),
    confirmed: false,
  };
}

export function hasDraft(draft: MistDraft): boolean {
  return Boolean(draft.mechanism || draft.symptoms);
}
