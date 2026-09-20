"use client";

import { useEffect, useMemo, useState } from "react";
import type { IncidentEvent } from "./incidents";
import type { BusStatus } from "./useIncidentBus";
import styles from "./AudioAlerts.module.css";
import { ACTION_LABELS, audioAssessmentLabel } from "../audio-ai/types";
import { safetySignalLabel } from "../audio-ai/safetySignal";

export function isAudioConcern(event: IncidentEvent) {
  return (
    event.origin === "model" &&
    event.kind === "transcript" &&
    event.title.startsWith("Audio concern")
  );
}

/** One recent alert per capture source, shared through the incident log. */
export function useAudioAlerts(events: IncidentEvent[]) {
  const [now, setNow] = useState(0);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const timer = setInterval(tick, 5000);
    return () => clearInterval(timer);
  }, []);
  return useMemo(() => {
    const sources = new Set<string>();
    const reviewed = new Set(
      events.filter((event) => event.kind === "audio_review").map((event) => event.id),
    );
    const urgency = (event: IncidentEvent) =>
      event.audioSafetySignal?.level === "urgent" ||
      event.audioAssessment?.status === "urgent_threat"
        ? 2
        : 1;
    return [...events]
      .sort((a, b) => urgency(b) - urgency(a) || b.seq - a.seq)
      .filter((event) => {
        if (
          event.audioAssessment &&
          events.some((item) => item.audioSafetySignal?.assessment_id === event.id)
        )
          return false;
        const age = now - Date.parse(event.observedAt ?? event.at);
        const retained =
          Boolean(event.audioSafetySignal) || event.audioAssessment?.status === "urgent_threat";
        if (
          !isAudioConcern(event) ||
          age < 0 ||
          (!retained && age > 120_000) ||
          reviewed.has(`review-${event.id}`) ||
          sources.has(event.source)
        )
          return false;
        sources.add(event.source);
        return true;
      })
      .slice(0, 12)
      .map((event) => {
        if (event.location || !event.audioSafetySignal) return event;
        // Keep the phrase alert as the primary report, but retain the exact
        // source/capture-matched GPS annotation from its contextual assessment.
        const context = events.find(
          (item) =>
            item.id === event.audioSafetySignal?.assessment_id &&
            item.source === event.source &&
            item.observedAt === event.observedAt &&
            item.audioAssessment?.input_kind === "microphone" &&
            event.audioSafetySignal?.input_kind === "microphone",
        );
        return context?.location ? { ...event, location: context.location } : event;
      });
  }, [events, now]);
}

export function AudioAlerts({
  alerts,
  status,
  onSelect,
}: {
  alerts: IncidentEvent[];
  status: BusStatus;
  onSelect: (event: IncidentEvent) => void;
}) {
  if (!alerts.length) return null;
  return (
    <aside className={styles.panel} aria-label="Shared audio alerts">
      <strong role="alert">
        {alerts.length} audio {alerts.length === 1 ? "alert" : "alerts"} ·{" "}
        {status === "live" ? "shared with workspaces" : "updates disconnected"}
      </strong>
      {alerts.map((event) => (
        <button key={event.id} onClick={() => onSelect(event)}>
          <strong>
            {event.audioSafetySignal
              ? safetySignalLabel(event.audioSafetySignal)
              : event.audioAssessment
                ? audioAssessmentLabel(event.audioAssessment)
                : "Audio phrase match"}{" "}
            · {event.personId ?? event.source}
          </strong>
          {event.audioSafetySignal && (
            <span>
              {event.audioSafetySignal.input_kind === "manual" ? "Manual demo" : "Audio clip"} ·
              Phrase rule, not model confidence · Awaiting human review
            </span>
          )}
          {event.audioAssessment && (
            <span>
              {event.audioAssessment.input_kind === "manual" ? "Manual demo · " : "Audio clip · "}
              {Math.round(event.audioAssessment.confidence * 100)}% model confidence ·{" "}
              {ACTION_LABELS[event.audioAssessment.recommended_action]}
            </span>
          )}
          <span>
            {event.location
              ? "View reporting officer’s GPS location"
              : "Officer GPS unavailable — review report"}
          </span>
          <small>{event.detail}</small>
        </button>
      ))}
      <small>
        Unverified speech; speaker unknown. Red pins mark reporting officers, not suspects. Alerts
        from phrase rules and urgent AI reports stay pending until acknowledged; old reports are not
        live scene information.
      </small>
    </aside>
  );
}
