"use client";

import { useEffect, useId, useState } from "react";
import { ArrowUpRight, CirclePause, ShieldAlert, Sparkles } from "lucide-react";
import type { DemoAmbulanceMission } from "./demoAmbulance";
import styles from "./AmbulanceSignalBar.module.css";

interface Props {
  mission: DemoAmbulanceMission | null;
  /** True only when the operator has explicitly chosen an incident. */
  selected: boolean;
  status: "connecting" | "synced" | "offline";
  updatedAt: string | null;
  modelContext?: { title: string; detail: string; at: string } | null;
}

const RELAY_MAX_AGE_MS = 15_000;
const FUTURE_TOLERANCE_MS = 5_000;

export function hasCurrentAmbulanceAuthorization(
  mission: DemoAmbulanceMission | null,
  status: "connecting" | "synced" | "offline",
  updatedAt: string | null,
  now: number | null,
) {
  const relayAt = updatedAt ? Date.parse(updatedAt) : NaN;
  const authorizationAt = mission?.engagedAt ? Date.parse(mission.engagedAt) : NaN;
  return (
    now !== null &&
    status === "synced" &&
    mission?.status === "engaged" &&
    Number.isFinite(relayAt) &&
    now - relayAt >= -1_000 &&
    now - relayAt < RELAY_MAX_AGE_MS &&
    Number.isFinite(authorizationAt) &&
    authorizationAt <= now + FUTURE_TOLERANCE_MS &&
    authorizationAt <= relayAt + FUTURE_TOLERANCE_MS
  );
}

function timeLabel(timestamp: string | null) {
  if (!timestamp || !Number.isFinite(Date.parse(timestamp))) return "Not received";
  return `${new Date(timestamp).toISOString().slice(11, 19)} UTC`;
}

/** Presentation-only demo signal. Model output never grants scene-entry permission. */
export function AmbulanceSignalBar({
  mission,
  selected,
  status,
  updatedAt,
  modelContext = null,
}: Props) {
  const headingId = useId();
  // Start closed during SSR/hydration; only a browser wall-clock check can show GO.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const update = () => setNow(Date.now());
    const firstTick = requestAnimationFrame(update);
    const timer = setInterval(update, 1_000);
    return () => {
      cancelAnimationFrame(firstTick);
      clearInterval(timer);
    };
  }, []);

  const relayAt = updatedAt ? Date.parse(updatedAt) : NaN;
  const fresh =
    now !== null &&
    status === "synced" &&
    Number.isFinite(relayAt) &&
    now - relayAt >= -1_000 &&
    now - relayAt < RELAY_MAX_AGE_MS;
  const authorized = selected && hasCurrentAmbulanceAuthorization(mission, status, updatedAt, now);

  let headline = "HOLD — scene entry";
  let instruction = "Select an assigned incident to view its entry signal.";
  let reason = "No incident selected";
  if (selected && !mission) {
    instruction = "Assignment unavailable. Do not enter the scene.";
    reason = "Selected assignment missing";
  } else if (selected && mission) {
    if (!fresh) {
      instruction = "Updates unconfirmed. Hold scene entry and contact Command.";
      reason = status === "connecting" ? "Connecting to Command" : "Command updates unavailable";
    } else if (mission.status === "cancelled") {
      instruction = "This assignment was cancelled. Await new instructions.";
      reason = "Assignment cancelled";
    } else if (mission.status === "en-route") {
      instruction = "Travel to staging; do not enter scene.";
      reason = "En route to staging";
    } else if (mission.status === "staged") {
      instruction = "Remain at staging. Await explicit authorization from Command.";
      reason = "At staging · awaiting Command";
    } else if (authorized) {
      headline = "GO — simulated engagement";
      instruction = `Command authorized simulated engagement at ${mission.hotspotId}.`;
      reason = `Authorized ${timeLabel(mission.engagedAt)}`;
    } else {
      instruction = "Authorization is unconfirmed. Hold scene entry and contact Command.";
      reason = "Authorization timestamp unavailable";
    }
  }

  return (
    <section className={styles.signal} data-authorized={authorized} aria-labelledby={headingId}>
      <div className={styles.primary}>
        <header className={styles.header}>
          <span className={styles.eyebrow}>
            <ShieldAlert size={14} aria-hidden="true" /> SCENE ENTRY
          </span>
          <span className={styles.simulation}>SIMULATION · NOT REAL CLEARANCE</span>
        </header>
        <div className={styles.signalBody} role="status" aria-live="polite" aria-atomic="true">
          <div className={styles.word} aria-hidden="true">
            {authorized ? <ArrowUpRight /> : <CirclePause />}
            <strong>{authorized ? "GO" : "STOP"}</strong>
          </div>
          <div className={styles.instructions}>
            <h2 id={headingId}>{headline}</h2>
            <p>{instruction}</p>
            <span>{reason}</span>
          </div>
        </div>
      </div>
      <aside className={styles.observations} aria-label="AI observations">
        <span className={styles.eyebrow}>
          <Sparkles size={14} aria-hidden="true" /> AI OBSERVATIONS
        </span>
        {modelContext ? (
          <>
            <h3>{modelContext.title}</h3>
            <p>{modelContext.detail}</p>
            <span className={styles.contextTime}>Recorded {timeLabel(modelContext.at)}</span>
          </>
        ) : (
          <>
            <h3>No incident-linked inference</h3>
            <p>Awaiting observations for the selected incident.</p>
          </>
        )}
      </aside>
    </section>
  );
}
