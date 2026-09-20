"use client";

import { useState } from "react";
import type { IncidentDraft, IncidentEvent } from "../paw-patrol/incidents";
import type { BusStatus } from "../paw-patrol/useIncidentBus";
import { safetySignalLabel } from "./safetySignal";
import { STATUS_LABELS } from "./types";
import styles from "./AudioIntelligencePanel.module.css";

export function AudioSafetyAlerts({
  events,
  status,
  publish,
}: {
  events: IncidentEvent[];
  status: BusStatus;
  publish: (draft: IncidentDraft) => Promise<boolean>;
}) {
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState("");
  const alerts = events
    .filter(
      (event) =>
        event.audioSafetySignal && !events.some((item) => item.id === `review-${event.id}`),
    )
    .sort(
      (a, b) =>
        Number(b.audioSafetySignal?.level === "urgent") -
          Number(a.audioSafetySignal?.level === "urgent") || b.seq - a.seq,
    );
  if (!alerts.length) return null;
  async function review(event: IncidentEvent) {
    setSaving(event.id);
    const ok = await publish({
      id: `review-${event.id}`,
      kind: "audio_review",
      origin: "operator",
      scenarioAt: null,
      personId: event.personId,
      source: "dispatch-audio-review",
      title: `Phrase alert review acknowledged · ${event.personId ?? event.source}`,
      detail: `Dispatcher acknowledged ${event.id}. Review recorded only; this does not establish scene safety or dispatch units.`,
      provenance: null,
      requiresHumanReview: false,
    });
    setError(ok ? "" : "Could not save the acknowledgment. The alert remains pending.");
    setSaving(null);
  }
  return (
    <div aria-label="Pending audio safety alerts" className={styles.results}>
      <strong role="alert">
        {alerts.length} phrase {alerts.length === 1 ? "alert requires" : "alerts require"} review
      </strong>
      <small>
        High sensitivity: negation, jokes and training quotations can trigger these rules. Verify
        with the officer. A later model answer does not clear an alert.
      </small>
      {status !== "live" && <p role="alert">Feed disconnected — reports may be out of date.</p>}
      {error && <p role="alert">{error}</p>}
      {alerts.map((event) => {
        const signal = event.audioSafetySignal!;
        const assessment = events.find((item) => item.id === signal.assessment_id)?.audioAssessment;
        return (
          <article
            key={event.id}
            className={styles.result}
            data-status={signal.level === "urgent" ? "urgent_threat" : "potential_threat"}
          >
            <strong>{safetySignalLabel(signal)}</strong>
            <small>
              {event.source} ·{" "}
              {signal.input_kind === "manual" ? "MANUAL DEMO INPUT" : "AUDIO CLIP TRANSCRIPT"} ·
              Captured {new Date(event.observedAt ?? event.at).toLocaleTimeString()} · Pending
              review
            </small>
            <blockquote>“{signal.transcript}”</blockquote>
            <p className={styles.recommendation}>
              {signal.level === "urgent"
                ? "Contact officer immediately; urgent dispatcher review for backup."
                : "Contact officer and review need for backup."}
            </p>
            <small>
              Phrase evidence: {signal.matches.join(" · ")} · Deterministic rule; no confidence
              score.
            </small>
            {assessment ? (
              <details>
                <summary>
                  AI context: {STATUS_LABELS[assessment.status]} (
                  {Math.round(assessment.confidence * 100)}% model confidence)
                </summary>
                <p>{assessment.summary}</p>
                <small>
                  {assessment.uncertainty} · {assessment.provider}/{assessment.model}
                </small>
              </details>
            ) : (
              <p>AI context has not arrived or is unavailable. The phrase alert remains active.</p>
            )}
            <button
              disabled={saving !== null || status !== "live"}
              onClick={() => void review(event)}
            >
              {saving === event.id ? "Saving…" : "Acknowledge phrase alert review"}
            </button>
          </article>
        );
      })}
    </div>
  );
}
