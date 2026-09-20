"use client";

import dynamic from "next/dynamic";
import { useEffect, useId, useMemo, useState, type FormEvent } from "react";
import {
  Activity,
  ArrowUpRight,
  CircleHelp,
  Eye,
  ScanLine,
  ShieldAlert,
  StickyNote,
  X,
} from "lucide-react";
import { BODY_REGIONS, type BodyRegionId } from "../anatomy/bodyRegions";
import {
  getBodyObservations,
  bodySourceIds,
  makeDemoBodyObservations,
  type BodyObservation,
} from "../anatomy/bodyEvidence";
import type { HeartRateConnection } from "../heart-rate/useHeartRate";
import type { IncidentEvent } from "./incidents";
import type { Person } from "./scenario";
import { PEOPLE } from "./scenario";
import type { BusStatus } from "./useIncidentBus";
import type { OfficerMediaInput } from "./OfficerFeed";
import { HospitalHeartMonitor } from "./HospitalHeartMonitor";
import { HospitalSceneFeed } from "./HospitalSceneFeed";
import styles from "./HospitalAssessment.module.css";
import hospitalStyles from "./HospitalWorkspace.module.css";

const AnatomyViewer = dynamic(() => import("../anatomy/AnatomyViewer"), {
  ssr: false,
  loading: () => (
    <div className={styles.modelLoading} role="status">
      <ScanLine size={30} /> Preparing body view…
    </div>
  ),
});

interface Props {
  person: Person;
  onSelect: (id: string) => void;
  heartRate: HeartRateConnection;
  previewTime?: number;
  session: number;
  events: IncidentEvent[];
  busStatus: BusStatus;
  media?: OfficerMediaInput | null;
  theme: "light" | "dark";
}

export function HospitalAssessment(props: Props) {
  // Review markers, camera choice and sample state never leak to another person.
  return <AssessmentSession key={`${props.person.id}:${props.session}`} {...props} />;
}

function AssessmentSession({
  person,
  onSelect,
  heartRate,
  previewTime,
  events,
  busStatus,
  media,
  theme,
}: Props) {
  const personSelectId = useId();
  const noteId = useId();
  const reportSourceId = useId();
  const [reportSource, setReportSource] = useState<string | null>(null);
  const [region, setRegion] = useState<BodyRegionId | null>(null);
  const [demo, setDemo] = useState<BodyObservation[]>([]);
  const [notes, setNotes] = useState<BodyObservation[]>([]);
  const [writing, setWriting] = useState(false);
  const [note, setNote] = useState("");
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const update = () => setNow(Date.now());
    const first = requestAnimationFrame(update);
    const timer = setInterval(update, 1000);
    return () => {
      cancelAnimationFrame(first);
      clearInterval(timer);
    };
  }, []);
  const reportSources = [
    ...new Set(events.flatMap((event) => (event.personId ? [event.personId] : []))),
  ];
  const received =
    now === null ? [] : getBodyObservations(events, reportSource ?? person.id, busStatus, now);
  const observations = [...notes, ...demo, ...received];
  const highlights = useMemo(
    () => [...new Set([...notes, ...demo].flatMap((item) => (item.region ? [item.region] : [])))],
    [notes, demo],
  );
  const selectedLabel = BODY_REGIONS.find((item) => item.id === region)?.label;
  const matching = region ? observations.filter((item) => item.region === region) : observations;
  const unlocated = received.filter((item) => item.region === null);
  function selectRegion(value: BodyRegionId | null) {
    setRegion(value);
    setWriting(false);
    setNote("");
  }
  function addNote(event: FormEvent) {
    event.preventDefault();
    if (!region || !note.trim() || notes.length >= 20) return;
    const at = new Date().toISOString();
    setNotes((current) => [
      {
        id: `local-note-${crypto.randomUUID()}`,
        personId: person.id,
        region,
        title: `${selectedLabel} · review note`,
        detail: note.trim(),
        source: "Local operator note · not shared",
        origin: "operator",
        at,
        confidence: null,
        state: "current",
      },
      ...current,
    ]);
    setWriting(false);
    setNote("");
  }
  return (
    <section className={styles.assessment} aria-label="Officer assessment workspace">
      <header className={styles.heading}>
        <div>
          <span className={styles.eyebrow}>
            <ScanLine size={14} /> PATIENT CONTEXT
          </span>
          <h2>Body &amp; scene review</h2>
        </div>
        <div className={styles.profilePicker}>
          <label htmlFor={personSelectId}>Reviewing officer</label>
          <select
            id={personSelectId}
            value={person.id}
            onChange={(event) => onSelect(event.target.value)}
          >
            {PEOPLE.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} · {item.id}
              </option>
            ))}
          </select>
          <button
            type="button"
            className={styles.demoButton}
            aria-pressed={demo.length > 0}
            onClick={() => {
              setDemo((current) =>
                current.length ? [] : makeDemoBodyObservations(person.id, Date.now()),
              );
              selectRegion(null);
            }}
          >
            <Eye size={14} />
            {demo.length ? "Hide demo observations" : "Preview demo observations"}
          </button>
        </div>
      </header>
      <div className={styles.layout}>
        <div className={styles.bodyColumn}>
          <AnatomyViewer
            personId={person.id}
            personName={person.name}
            interactive
            theme={theme}
            selectedRegion={region}
            onSelectRegion={selectRegion}
            highlightedRegions={highlights}
          />
        </div>
        <div className={styles.contextColumn}>
          <div className={styles.telemetry}>
            <HospitalSceneFeed personId={person.id} media={media} />
            <div className={`${styles.vitals} ${hospitalStyles.assessmentVitals}`}>
              <HospitalHeartMonitor
                personId={person.id}
                connection={heartRate}
                previewTime={previewTime}
              />
              <p>
                <Activity size={13} />
                {heartRate.mode === "demo" ? "Simulated vitals" : "Received sensor values"} · not an
                ECG
              </p>
              <span>Heart rate does not locate an injury.</span>
            </div>
          </div>
          <section className={styles.evidence} aria-label="Body region observations">
            <header className={styles.cardHeader}>
              <div>
                <span className={styles.eyebrow}>OBSERVATIONS / HUMAN REVIEW</span>
                <h2>{selectedLabel ?? "Reported concerns"}</h2>
              </div>
              {region ? (
                <button
                  type="button"
                  className={styles.clearButton}
                  onClick={() => selectRegion(null)}
                >
                  <X size={14} /> All regions
                </button>
              ) : (
                <span>
                  {busStatus === "live"
                    ? "Log connected"
                    : busStatus === "connecting"
                      ? "Connecting"
                      : "Log offline"}
                </span>
              )}
            </header>
            <div className={styles.profilePicker}>
              <label htmlFor={reportSourceId}>Report source</label>
              <select
                id={reportSourceId}
                value={reportSource ?? ""}
                onChange={(event) => setReportSource(event.target.value || null)}
              >
                <option value="">{person.id} · matching unit-slot labels</option>
                {reportSource && !reportSources.includes(reportSource) && (
                  <option value={reportSource}>{reportSource} · no current reports</option>
                )}
                {reportSources
                  .filter(
                    (source) => !bodySourceIds(person.id).includes(source) || source !== person.id,
                  )
                  .map((source) => (
                    <option key={source} value={source}>
                      {source} · wearer unverified
                    </option>
                  ))}
              </select>
            </div>
            {demo.length > 0 && (
              <div className={styles.demoNotice} role="status">
                DEMO PREVIEW · fictional observations, not camera or sensor findings
              </div>
            )}
            <div className={styles.observationList}>
              {matching.length ? (
                matching.map((item) => (
                  <Observation
                    key={item.id}
                    item={item}
                    onSelect={selectRegion}
                    onRemove={
                      notes.includes(item)
                        ? () =>
                            setNotes((current) => current.filter((entry) => entry.id !== item.id))
                        : undefined
                    }
                  />
                ))
              ) : (
                <div className={styles.emptyEvidence}>
                  <CircleHelp size={25} />
                  <strong>
                    {region ? "No localized observation" : "No received observations"}
                  </strong>
                  <p>
                    {region
                      ? `No information establishes the condition of this ${selectedLabel?.toLowerCase()}.`
                      : "Select the body to inspect a region, or preview demo observations."}
                  </p>
                  <span>Not assessed · not an all-clear</span>
                </div>
              )}
            </div>
            {region && unlocated.length > 0 && (
              <button type="button" className={styles.unlocated} onClick={() => selectRegion(null)}>
                {unlocated.length} report{unlocated.length === 1 ? "" : "s"} without a body location{" "}
                <ArrowUpRight size={14} />
              </button>
            )}
            {region && (
              <div className={styles.noteArea}>
                {writing ? (
                  <form onSubmit={addNote}>
                    <label htmlFor={noteId}>{selectedLabel} · local review note</label>
                    <textarea
                      id={noteId}
                      value={note}
                      onChange={(event) => setNote(event.target.value)}
                      placeholder="Record what was observed and its source…"
                      required
                      maxLength={400}
                      rows={2}
                    />
                    <div>
                      <span>Only this view · not sent to Command or AI</span>
                      <button type="button" onClick={() => setWriting(false)}>
                        Cancel
                      </button>
                      <button type="submit" disabled={!note.trim()}>
                        Save note
                      </button>
                    </div>
                  </form>
                ) : (
                  <button
                    type="button"
                    disabled={notes.length >= 20}
                    onClick={() => setWriting(true)}
                  >
                    <StickyNote size={14} /> Add review note
                    {notes.length >= 20 ? " · limit reached" : ""}
                  </button>
                )}
              </div>
            )}
            <footer className={styles.evidenceFooter}>
              <ShieldAlert size={13} /> Observations are not diagnoses or scene-entry clearance.
            </footer>
          </section>
        </div>
      </div>
    </section>
  );
}

function Observation({
  item,
  onSelect,
  onRemove,
}: {
  item: BodyObservation;
  onSelect: (region: BodyRegionId | null) => void;
  onRemove?: () => void;
}) {
  const location = BODY_REGIONS.find((region) => region.id === item.region)?.label;
  const local = onRemove !== undefined;
  return (
    <article className={styles.observation} data-region={Boolean(item.region)}>
      <div className={styles.observationMeta}>
        <span>
          {local
            ? "LOCAL NOTE"
            : item.state === "sample"
              ? "DEMO SAMPLE"
              : item.origin === "model"
                ? "MODEL · UNREVIEWED"
                : "RECEIVED REPORT"}
        </span>
        <span>
          {local
            ? "Not shared"
            : item.state === "current"
              ? "Recent"
              : item.state === "stale"
                ? "STALE / UNCONFIRMED"
                : "Illustrative"}
        </span>
      </div>
      <h3>{item.title}</h3>
      <p>{item.detail}</p>
      <div className={styles.observationBottom}>
        {item.region ? (
          <button type="button" onClick={() => onSelect(item.region)}>
            {location} <ArrowUpRight size={13} />
          </button>
        ) : (
          <span>Body location not supplied</span>
        )}
        {item.confidence !== null && (
          <span className={styles.score}>
            {Math.round(item.confidence * 100)}%{" "}
            <small>{item.state === "sample" ? "example score" : "model score"}</small>
          </span>
        )}
        {onRemove && (
          <button type="button" aria-label={`Remove local note for ${location}`} onClick={onRemove}>
            <X size={13} />
          </button>
        )}
      </div>
      <footer>
        {item.source} ·{" "}
        <time dateTime={item.at}>{new Date(item.at).toISOString().slice(11, 19)} UTC</time>
        {item.confidence !== null && <span>Uncalibrated · not injury probability</span>}
      </footer>
    </article>
  );
}
