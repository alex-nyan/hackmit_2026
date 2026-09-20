"use client";

import { useEffect, useMemo, useState } from "react";
import type { IncidentEvent } from "./incidents";
import type { BusStatus } from "./useIncidentBus";
import styles from "./AudioAlerts.module.css";

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
    return [...events]
      .sort((a, b) => b.seq - a.seq)
      .filter((event) => {
        const age = now - Date.parse(event.observedAt ?? event.at);
        if (!isAudioConcern(event) || age < 0 || age > 120_000 || sources.has(event.source))
          return false;
        sources.add(event.source);
        return true;
      })
      .slice(0, 12);
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
          <strong>Audio concern · {event.personId ?? event.source}</strong>
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
        leave the map after two minutes; reports remain in the log.
      </small>
    </aside>
  );
}
