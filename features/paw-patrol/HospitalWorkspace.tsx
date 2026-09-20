"use client";

import { useId, useState } from "react";
import {
  Ambulance,
  Sun,
  Moon,
  Bluetooth,
  ChevronDown,
  Pause,
  Play,
  RotateCcw,
  SlidersHorizontal,
} from "lucide-react";
import type { HeartRateConnection } from "../heart-rate/useHeartRate";
import { PEOPLE, type Person } from "./scenario";
import { byNewest, type IncidentEvent } from "./incidents";
import { BusIndicator, SharedTimeline } from "./Provenance";
import type { BusStatus } from "./useIncidentBus";
import type { OfficerMediaInput } from "./OfficerFeed";
import styles from "./HospitalWorkspace.module.css";
import { HospitalAssessment } from "./HospitalAssessment";
import { HospitalDispatchHandoff } from "./HospitalDispatchHandoff";
import type { DemoAmbulanceMission } from "./demoAmbulance";
import { AmbulanceSignalBar } from "./AmbulanceSignalBar";

// Scene reports in the existing demo bus use these exact titles. Neither model
// detections nor missing observations can create an access clearance.
export function hospitalAccess(events: IncidentEvent[], personId: string, status: BusStatus) {
  const report = events
    .filter(
      (event) =>
        event.kind === "scene" &&
        event.origin === "operator" &&
        (event.personId === null || event.personId === personId),
    )
    .sort(byNewest)[0];
  const cleared = status === "live" && report?.title === "Scene reported cleared";
  const unsafe = report?.title === "Scene reported unsafe";
  return {
    cleared,
    label: cleared
      ? "Access cleared"
      : unsafe
        ? "Hold · Scene unsafe"
        : "Hold · Clearance unconfirmed",
    detail:
      status !== "live"
        ? "Scene updates disconnected"
        : report
          ? `${report.source} · ${new Date(report.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
          : "No clearance reported",
  };
}

export function HospitalWorkspace({
  person,
  onSelect,
  heartRate,
  session,
  events,
  busStatus,
  media,
  running,
  onPlay,
  onPause,
  onReset,
  handoff,
  theme = "dark",
  onToggleTheme,
}: {
  person: Person;
  onSelect: (id: string) => void;
  heartRate: HeartRateConnection;
  session: number;
  events: IncidentEvent[];
  busStatus: BusStatus;
  media?: OfficerMediaInput | null;
  running: boolean;
  onPlay: () => void;
  onPause: () => void;
  onReset: () => void;
  theme?: "light" | "dark";
  onToggleTheme?: () => void;
  handoff?: {
    missions: DemoAmbulanceMission[];
    status: "connecting" | "synced" | "offline";
    updatedAt: string | null;
  };
}) {
  const missionSelectId = useId();
  const [selectedMissionId, setSelectedMissionId] = useState<string | null>(null);
  const mission = handoff?.missions.find((item) => item.id === selectedMissionId) ?? null;
  const access = hospitalAccess(events, person.id, busStatus);
  const officerReport = access.cleared
    ? "Reported clear"
    : access.label === "Hold · Scene unsafe"
      ? "Reported unsafe"
      : "Unconfirmed";
  const audio = events
    .filter((event) => event.kind === "transcript" && event.personId === person.id)
    .sort(byNewest)[0];
  const connected = ["waiting", "receiving", "stale"].includes(heartRate.status);
  const busy = ["requesting", "connecting"].includes(heartRate.status);
  const reconnect = ["disconnected", "error"].includes(heartRate.status);
  return (
    <>
      <div className={styles.ambulanceLanding}>
        <header className={styles.ambulanceHeading}>
          <div>
            <span className={styles.ambulanceEyebrow}>
              <Ambulance size={15} aria-hidden="true" /> MEDICAL RESPONSE
            </span>
            <h1>Ambulance dashboard</h1>
          </div>
          <div className={styles.headingControls}>
            {onToggleTheme && (
              <button
                type="button"
                className={styles.themeButton}
                aria-label="Toggle ambulance theme"
                onClick={onToggleTheme}
              >
                {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
              </button>
            )}
            <div className={styles.missionSelection}>
              <label htmlFor={missionSelectId}>Incident / ambulance</label>
              <select
                id={missionSelectId}
                value={selectedMissionId ?? ""}
                onChange={(event) => setSelectedMissionId(event.target.value || null)}
              >
                <option value="">Select a dispatched ambulance</option>
                {selectedMissionId && !mission && (
                  <option value={selectedMissionId}>Selected handoff unavailable</option>
                )}
                {handoff?.missions.map((item, index) => (
                  <option key={item.id} value={item.id}>
                    {item.hotspotId} · Ambulance {index + 1} ·{" "}
                    {item.status === "staged"
                      ? "Holding"
                      : item.status === "engaged"
                        ? "Authorized"
                        : item.status === "cancelled"
                          ? "Cancelled"
                          : "En route"}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </header>
        <AmbulanceSignalBar
          mission={mission}
          selected={selectedMissionId !== null}
          status={handoff?.status ?? "offline"}
          updatedAt={handoff?.updatedAt ?? null}
        />
      </div>
      <HospitalAssessment
        person={person}
        onSelect={onSelect}
        heartRate={heartRate}
        session={session}
        events={events}
        busStatus={busStatus}
        media={media}
        theme={theme}
      />

      <div className={styles.utilities} id="hospital-connections">
        {handoff && (
          <HospitalDispatchHandoff
            {...handoff}
            selection={{ id: selectedMissionId, onSelect: setSelectedMissionId }}
          />
        )}
        <details className={styles.connections}>
          <summary>
            <SlidersHorizontal size={18} aria-hidden="true" />
            <span>Connections</span>
            <ChevronDown size={17} aria-hidden="true" />
          </summary>
          <div className={styles.connectionBody}>
            <div className={styles.connectionRow}>
              <h2>Officer</h2>
              <label className="sr-only" htmlFor="hospital-person">
                Selected person
              </label>
              <select
                id="hospital-person"
                value={person.id}
                onChange={(event) => onSelect(event.target.value)}
              >
                {PEOPLE.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.id} · {item.name}
                  </option>
                ))}
              </select>
            </div>
            <section className={styles.connectionRow} aria-label="Heart rate connection">
              <div>
                <h2>Heart rate</h2>
                <p>
                  {person.id} · {heartRate.deviceName ?? "Not connected"}
                </p>
              </div>
              <div className={styles.actions}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => (connected ? heartRate.disconnect() : void heartRate.connect())}
                >
                  <Bluetooth size={16} aria-hidden="true" />
                  {connected
                    ? "Disconnect"
                    : busy
                      ? "Connecting…"
                      : reconnect
                        ? "Reconnect Heart Rate"
                        : "Connect Heart Rate"}
                </button>
                {heartRate.mode === "device" && (
                  <button type="button" onClick={heartRate.useDemo}>
                    Use preview
                  </button>
                )}
              </div>
              {heartRate.mode === "device" && (
                <p className={styles.connectionMessage} role="status">
                  {heartRate.message}
                </p>
              )}
              {heartRate.supported === false && (
                <p className={styles.connectionMessage}>
                  Bluetooth requires Chrome on localhost or HTTPS.
                </p>
              )}
            </section>
            <section className={styles.connectionRow} aria-label="Camera connection">
              <div>
                <h2>Officer camera &amp; audio</h2>
                <p>
                  {media?.personId === person.id
                    ? "Media input attached"
                    : "No media input attached"}
                </p>
              </div>
            </section>
            <div className={styles.connectionRow}>
              <div>
                <h2>Preview controls</h2>
              </div>
              <div className={styles.actions}>
                <button
                  type="button"
                  aria-label={running ? "Pause demo" : "Run demo"}
                  onClick={running ? onPause : onPlay}
                >
                  {running ? <Pause size={16} /> : <Play size={16} />}
                  {running ? "Pause" : "Run"}
                </button>
                <button type="button" aria-label="Reset demo" onClick={onReset}>
                  <RotateCcw size={16} />
                  Reset
                </button>
              </div>
            </div>
          </div>
        </details>
        <details className={styles.activity}>
          <summary>
            Activity &amp; source details <ChevronDown size={16} aria-hidden="true" />
          </summary>
          <section className={styles.transcript} aria-label="Latest audio report">
            <h2>Latest audio report</h2>
            {audio ? (
              <>
                <p>Machine transcript · unverified</p>
                <p>{audio.detail}</p>
                <time dateTime={audio.at}>
                  {new Date(audio.at).toLocaleTimeString()} · {audio.source}
                </time>
              </>
            ) : (
              <p>Audio reports will appear here.</p>
            )}
          </section>
          <p title={access.detail}>
            Officer report: {officerReport} · not ambulance entry authorization
          </p>
          <BusIndicator status={busStatus} count={events.length} />
          <h2>Shared incident log</h2>
          <SharedTimeline events={events} />
        </details>
      </div>
    </>
  );
}
