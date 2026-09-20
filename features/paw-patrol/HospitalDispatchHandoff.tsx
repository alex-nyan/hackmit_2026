"use client";

import { useEffect, useId, useState } from "react";
import { Ambulance, ArrowRight, Clock3, MapPin, Radio, ShieldAlert } from "lucide-react";
import type { DemoAmbulanceMission } from "./demoAmbulance";
import { InferencePreview } from "./InferencePreview";
import { hasCurrentAmbulanceAuthorization } from "./AmbulanceSignalBar";
import styles from "./HospitalDispatchHandoff.module.css";

interface Props {
  missions: DemoAmbulanceMission[];
  status: "connecting" | "synced" | "offline";
  updatedAt: string | null;
  selection?: { id: string | null; onSelect: (id: string | null) => void };
}

const SNAPSHOT_MAX_AGE_MS = 15_000;
const STAGE_LABELS: Record<DemoAmbulanceMission["status"], string> = {
  "en-route": "En route",
  staged: "Arrived · HOLD",
  engaged: "Entry authorized",
  cancelled: "Cancelled",
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
export function HospitalDispatchHandoff({ missions, status, updatedAt, selection }: Props) {
  const headingId = useId();
  const selectId = useId();
  const inferenceId = useId();
  const [localSelectedId, setLocalSelectedId] = useState<string | null>(null);
  const selectedId = selection === undefined ? localSelectedId : selection.id;
  const setSelectedId = selection?.onSelect ?? setLocalSelectedId;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);

  // A chosen incident must never silently change if it disappears from a snapshot.
  const mission = selectedId
    ? missions.find((item) => item.id === selectedId)
    : selection === undefined && missions.length === 1
      ? missions[0]
      : undefined;
  const snapshotAt = updatedAt ? Date.parse(updatedAt) : NaN;
  const snapshotAge = now - snapshotAt;
  const fresh =
    status === "synced" &&
    Number.isFinite(snapshotAt) &&
    snapshotAge >= -1_000 &&
    snapshotAge < SNAPSHOT_MAX_AGE_MS;
  const authorized = hasCurrentAmbulanceAuthorization(mission ?? null, status, updatedAt, now);
  const displayStage = !fresh
    ? "HOLD · updates unconfirmed"
    : mission
      ? mission.status === "engaged" && !authorized
        ? "HOLD · authorization unconfirmed"
        : STAGE_LABELS[mission.status]
      : "HOLD · select an incident";
  const stage =
    !fresh ||
    !mission ||
    mission.status === "cancelled" ||
    (mission.status === "engaged" && !authorized)
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
            ? "Connected"
            : status === "connecting"
              ? "Connecting · HOLD"
              : "Updates unavailable · HOLD"}
        </span>
      </header>
      {missions.length > 0 || selectedId ? (
        <>
          <div className={styles.selection}>
            <label htmlFor={selectId}>Incident / ambulance</label>
            <select
              id={selectId}
              value={mission?.id ?? ""}
              onChange={(event) => setSelectedId(event.target.value || null)}
            >
              <option value="" disabled>
                Choose an incident
              </option>
              {missions.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.hotspotId} · {item.id} · {STAGE_LABELS[item.status]}
                </option>
              ))}
            </select>
            <small>
              {missions.length} {missions.length === 1 ? "ambulance" : "ambulances"}
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
                    ? "Waiting for current status."
                    : authorized
                      ? "Command Centre authorized entry."
                      : mission.status === "cancelled"
                        ? "Mission ended."
                        : "Wait for Command Centre authorization."}
                </small>
              </div>
              <ol className={styles.progress} aria-label="Demo ambulance handoff stages">
                {["En route", "Arrived · HOLD", "Entry authorized"].map((label, index) => (
                  <li
                    key={label}
                    data-current={stage === index}
                    data-complete={stage > index}
                    aria-current={stage === index ? "step" : undefined}
                  >
                    <span aria-hidden="true">{index + 1}</span>
                    <strong>{label}</strong>
                  </li>
                ))}
              </ol>
              <div className={styles.body}>
                <div className={styles.context}>
                  <div className={styles.routeHeading}>
                    <MapPin size={14} aria-hidden="true" />
                    <h3>Route</h3>
                  </div>
                  <div className={styles.route}>
                    <div role="group" aria-label="Origin">
                      <strong>{mission.stationName}</strong>
                      <code>{coordinates(mission.stationPoint)}</code>
                    </div>
                    <ArrowRight size={17} aria-hidden="true" />
                    <div role="group" aria-label="Holding location">
                      <strong>{mission.hotspotId}</strong>
                      <code>{coordinates(mission.stagingPoint)}</code>
                    </div>
                  </div>
                  <h3 className={styles.timelineHeading}>
                    <Clock3 size={14} aria-hidden="true" /> Timeline
                  </h3>
                  <dl className={styles.timestamps}>
                    <div>
                      <dt>Dispatched</dt>
                      <dd>
                        <EventTime value={mission.createdAt} />
                      </dd>
                    </div>
                    <div>
                      <dt>Updated</dt>
                      <dd>
                        <EventTime value={mission.updatedAt} />
                      </dd>
                    </div>
                    <div>
                      <dt>Authorized</dt>
                      <dd>
                        <EventTime value={mission.engagedAt} empty="Not authorized" />
                      </dd>
                    </div>
                    <div>
                      <dt>Last synced</dt>
                      <dd>
                        <EventTime value={updatedAt} />
                      </dd>
                    </div>
                  </dl>
                </div>
                <aside className={styles.sample} aria-labelledby={inferenceId}>
                  <InferencePreview titleId={inferenceId} />
                  <p>Sample context · not linked to this incident or officer.</p>
                </aside>
              </div>
            </>
          ) : (
            <p className={styles.empty} role="status">
              {selectedId
                ? "Selected ambulance unavailable. Choose another incident."
                : "Select an incident to view its ambulance."}
            </p>
          )}
        </>
      ) : (
        <p className={styles.empty}>No handoff received.</p>
      )}
    </section>
  );
}
