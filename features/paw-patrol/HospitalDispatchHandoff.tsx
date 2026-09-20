"use client";

import { useEffect, useId, useState } from "react";
import { Ambulance, ArrowRight, Clock3, MapPin, Radio, ShieldAlert } from "lucide-react";
import type { DemoAmbulanceMission } from "./demoAmbulance";
import { InferencePreview } from "./InferencePreview";
import styles from "./HospitalDispatchHandoff.module.css";

interface Props {
  missions: DemoAmbulanceMission[];
  status: "connecting" | "synced" | "offline";
  updatedAt: string | null;
}

const SNAPSHOT_MAX_AGE_MS = 15_000;
const STAGE_LABELS: Record<DemoAmbulanceMission["status"], string> = {
  "en-route": "En route · demo",
  staged: "Arrived at staging · HOLD",
  engaged: "Operator authorized · demo",
  cancelled: "Cancelled · demo",
};

function coordinates(point: [number, number]) {
  return `${point[1].toFixed(5)}, ${point[0].toFixed(5)}`;
}

function EventTime({ value, empty = "Not recorded" }: { value: string | null; empty?: string }) {
  if (!value || !Number.isFinite(Date.parse(value))) return <span>{empty}</span>;
  return (
    <time dateTime={value}>{new Date(value).toISOString().replace("T", " ").slice(0, 19)} UTC</time>
  );
}

/** Read-only browser-demo context. Never alters hospital access or patient selection. */
export function HospitalDispatchHandoff({ missions, status, updatedAt }: Props) {
  const headingId = useId();
  const selectId = useId();
  const inferenceId = useId();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);

  // A chosen incident must never silently change if it disappears from a snapshot.
  const mission = selectedId
    ? missions.find((item) => item.id === selectedId)
    : missions.length === 1
      ? missions[0]
      : undefined;
  const snapshotAt = updatedAt ? Date.parse(updatedAt) : NaN;
  const snapshotAge = now - snapshotAt;
  const fresh =
    status === "synced" &&
    Number.isFinite(snapshotAt) &&
    snapshotAge >= -1_000 &&
    snapshotAge <= SNAPSHOT_MAX_AGE_MS;
  const displayStage = !fresh
    ? "HOLD · updates unconfirmed"
    : mission
      ? STAGE_LABELS[mission.status]
      : "HOLD · select a demo incident";
  const authorized = fresh && mission?.status === "engaged";
  const stage =
    !fresh || !mission || mission.status === "cancelled"
      ? -1
      : mission.status === "en-route"
        ? 0
        : mission.status === "staged"
          ? 1
          : 2;

  return (
    <section className={styles.handoff} aria-labelledby={headingId}>
      <header className={styles.heading}>
        <div>
          <p className={styles.eyebrow}>
            <Ambulance size={15} aria-hidden="true" /> COMMAND CENTRE / DEMO
          </p>
          <h2 id={headingId}>Dispatch handoff</h2>
        </div>
        <span className={styles.connection} data-fresh={fresh} role="status">
          <Radio size={13} aria-hidden="true" />
          {fresh
            ? "Browser demo connected"
            : status === "connecting"
              ? "Connecting · HOLD"
              : "Updates unavailable · HOLD"}
        </span>
      </header>
      <p className={styles.disclaimer}>
        Browser demo handoff; not a real dispatch or scene clearance.
      </p>

      {missions.length > 0 || selectedId ? (
        <>
          <div className={styles.selection}>
            <label htmlFor={selectId}>Demo incident / ambulance</label>
            <select
              id={selectId}
              value={mission?.id ?? ""}
              onChange={(event) => setSelectedId(event.target.value || null)}
            >
              <option value="" disabled>
                Choose a demo incident
              </option>
              {missions.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.hotspotId} · {item.id} · {STAGE_LABELS[item.status]}
                </option>
              ))}
            </select>
            <small>
              {missions.length} {missions.length === 1 ? "handoff" : "handoffs"} · independent of
              the officer camera selection
            </small>
          </div>

          {mission ? (
            <>
              <div className={styles.stageBanner} data-authorized={authorized} role="status">
                <ShieldAlert size={18} aria-hidden="true" />
                <div>
                  <strong>{displayStage}</strong>
                  <span>
                    {mission.hotspotId} · {mission.id}
                  </span>
                </div>
                <small>
                  {!fresh
                    ? `Last reported: ${STAGE_LABELS[mission.status]}. No current authorization is implied.`
                    : authorized
                      ? "Command-centre operator action, simulation only. Hospital scene-access rules are unchanged."
                      : mission.status === "cancelled"
                        ? "This simulated mission is no longer active."
                        : "Arrival is not permission to enter. Wait for an explicit operator action in the demo."}
                </small>
              </div>
              <ol className={styles.progress} aria-label="Demo ambulance handoff stages">
                {["En route", "Arrival · HOLD", "Operator authorized · demo"].map(
                  (label, index) => (
                    <li
                      key={label}
                      data-current={stage === index}
                      data-complete={stage > index}
                      aria-current={stage === index ? "step" : undefined}
                    >
                      <span aria-hidden="true">{index + 1}</span>
                      <strong>{label}</strong>
                    </li>
                  ),
                )}
              </ol>
              <div className={styles.body}>
                <div className={styles.context}>
                  <div className={styles.routeHeading}>
                    <MapPin size={14} aria-hidden="true" />
                    <h3>Demo route &amp; staging</h3>
                  </div>
                  <div className={styles.route}>
                    <div>
                      <span>Fictional origin</span>
                      <strong>{mission.stationName}</strong>
                      <code>{coordinates(mission.stationPoint)}</code>
                    </div>
                    <ArrowRight size={17} aria-hidden="true" />
                    <div>
                      <span>Staging point · hold here</span>
                      <strong>{mission.hotspotId}</strong>
                      <code>{coordinates(mission.stagingPoint)}</code>
                    </div>
                  </div>
                  <p className={styles.routeNote}>
                    Hotspot: <code>{coordinates(mission.hotspotPoint)}</code> · Simulation timing is
                    not a real ETA.
                  </p>
                  <h3 className={styles.timelineHeading}>
                    <Clock3 size={14} aria-hidden="true" /> Event timestamps
                  </h3>
                  <dl className={styles.timestamps}>
                    <div>
                      <dt>Dispatched</dt>
                      <dd>
                        <EventTime value={mission.createdAt} />
                      </dd>
                    </div>
                    <div>
                      <dt>Mission update</dt>
                      <dd>
                        <EventTime value={mission.updatedAt} />
                      </dd>
                    </div>
                    <div>
                      <dt>Operator authorization</dt>
                      <dd>
                        <EventTime value={mission.engagedAt} empty="Not authorized" />
                      </dd>
                    </div>
                    <div>
                      <dt>Last handoff sync</dt>
                      <dd>
                        <EventTime value={updatedAt} />
                      </dd>
                    </div>
                  </dl>
                </div>
                <aside className={styles.sample} aria-labelledby={inferenceId}>
                  <InferencePreview titleId={inferenceId} />
                  <p>
                    UI preview only — not an observation of this incident or the selected officer.
                  </p>
                </aside>
              </div>
            </>
          ) : (
            <p className={styles.empty} role="status">
              {selectedId
                ? "The selected demo handoff is no longer in the current snapshot. Choose an incident to continue; no other incident has been substituted."
                : "Choose an incident above to inspect its own staging status and context."}
            </p>
          )}
        </>
      ) : (
        <p className={styles.empty}>
          No demo ambulance handoffs received. Dispatch a simulated ambulance from Command Centre to
          populate this panel. Existing officer care and scene-access controls are unchanged.
        </p>
      )}
    </section>
  );
}
