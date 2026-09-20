import { describe, expect, it } from "vitest";

import { draftMist, hasDraft } from "./draftMist";
import type { IncidentEvent } from "./incidents";

let seq = 0;
function event(patch: Partial<IncidentEvent> = {}): IncidentEvent {
  seq += 1;
  return {
    seq,
    id: `event-${seq}`,
    kind: "hazard",
    origin: "model",
    at: "2026-09-19T22:00:00.000Z",
    scenarioAt: 15,
    title: "Possible weapon · unverified · P-01",
    detail: "A dark object is held in the right hand.",
    source: "Officer body camera",
    personId: "P-01",
    provenance: { provider: "ollama", model: "gemma4:26b", confidence: 0.42 },
    requiresHumanReview: true,
    ...patch,
  };
}

describe("draftMist", () => {
  it("never drafts an injury, however much evidence there is", () => {
    // The whole point of the draft is that it stops short of the clinical claim.
    const draft = draftMist(
      [
        event({ title: "Person down · unverified · P-01" }),
        event({ kind: "transcript", detail: 'Transcript hypothesis: "officer down".' }),
      ],
      "P-01",
    );
    expect(draft.injuries).toBe("");
    expect(draft.mechanism).not.toBe("");
    expect(draft.symptoms).not.toBe("");
  });

  it("marks everything it produces as unconfirmed", () => {
    const draft = draftMist([event()], "P-01");
    expect(draft.confirmed).toBe(false);
    expect(draft.mechanism).toContain("Unconfirmed");
    expect(draft.mechanism).toContain("not established by a person");
  });

  it("uses only model-origin events", () => {
    // An operator's own report is already recorded; folding it into the draft
    // would blur which half a machine proposed.
    const draft = draftMist(
      [
        event({ origin: "operator", provenance: null, title: "Assistance requested · P-01" }),
        event({ origin: "script", provenance: null, title: "Scripted injury report" }),
      ],
      "P-01",
    );
    expect(hasDraft(draft)).toBe(false);
    expect(draft.basis).toEqual([]);
  });

  it("does not borrow another person's evidence", () => {
    const draft = draftMist([event({ personId: "P-02" })], "P-01");
    expect(hasDraft(draft)).toBe(false);
  });

  it("lists the basis with model and score for each event", () => {
    const draft = draftMist([event()], "P-01");
    expect(draft.basis).toHaveLength(1);
    expect(draft.basis[0]).toContain("ollama/gemma4:26b");
    expect(draft.basis[0]).toContain("uncalibrated");
    expect(draft.basis[0]).toContain("00:15");
  });

  it("reports a missing score rather than inventing one", () => {
    const draft = draftMist(
      [event({ provenance: { provider: "faster_whisper", model: "base", confidence: null } })],
      "P-01",
    );
    expect(draft.basis[0]).toContain("no score");
  });

  it("returns an empty draft when there is nothing to say", () => {
    const draft = draftMist([], "P-01");
    expect(hasDraft(draft)).toBe(false);
    expect(draft.mechanism).toBe("");
    expect(draft.symptoms).toBe("");
  });
});
