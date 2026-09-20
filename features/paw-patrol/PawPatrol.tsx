"use client";

import { useCallback, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import {
  Shield,
  Radio,
  HeartPulse,
  Play,
  Pause,
  RotateCcw,
  SkipForward,
  ArrowUpRight,
  Camera,
  Mic,
  Watch,
  Smartphone,
  Laptop,
  X,
  Check,
  ArrowRight,
  Ambulance,
  WifiOff,
  Info,
  ChevronDown,
} from "lucide-react";
import { BodyCamWall } from "@/features/body-cam";
import { CapturePanel } from "@/features/camera-triage";
import { JoinCard } from "@/features/join";
import type { JoinLink } from "@/features/join";
import { OperationsMapPanel } from "./OperationsMapPanel";
import {
  DURATION,
  EVENTS,
  PEOPLE,
  PHASES,
  type Person,
  type View,
  phaseAt,
  personStatus,
  sampleHeartRate,
  stamp,
} from "./scenario";
import { useScenario, type DemoAction } from "./useScenario";
import { useDemoTools } from "./useDemoTools";
import { sceneAt, emsStatus, type MistRecord } from "./consult";
import { SceneCoordination, TacticalBrief, MistHandoff, emptyTactical } from "./ConsultPanels";
import { WORKSPACE_LABELS, WORKSPACE_VIEWS, type Workspace } from "./workspace";
import { useIncidentBus } from "./useIncidentBus";
import { hazardIncident, transcriptIncident } from "./hazardSignal";
import { draftMist, hasDraft, type MistDraft } from "./draftMist";
import type { IncidentDraft } from "./incidents";
import {
  BusIndicator,
  MistDraftCard,
  NotConcluded,
  PreArrival,
  SharedTimeline,
} from "./Provenance";
import type { TriageResult } from "../camera-triage/types";
import type { TranscriptionResult } from "../camera-triage/audio";

const AnatomyViewer = dynamic(() => import("../anatomy/AnatomyViewer"), {
  ssr: false,
  loading: () => (
    <div className="model-pending" role="status">
      Preparing anatomy viewer…
    </div>
  ),
});
const VIEW_NAMES = {
  command: "Command",
  officer: "Officer",
  hospital: "Hospital",
};

function HeartChart({ time, id }: { time: number; id: string }) {
  const values = Array.from({ length: 24 }, (_, i) =>
    sampleHeartRate(id, Math.max(0, time - (23 - i) * 2)),
  );
  const path = values.map((v, i) => `${i * 10},${80 - (v - 65) * 0.85}`).join(" ");
  return (
    <svg
      className="heart-chart"
      viewBox="0 0 230 84"
      role="img"
      aria-label="Synthetic heart rate trend"
    >
      <path d="M0 75H230M0 40H230M0 5H230" stroke="#dedfd9" strokeWidth="1" />
      <polyline
        points={path}
        fill="none"
        stroke="#343e8a"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      <circle cx="230" cy={80 - (values[23] - 65) * 0.85} r="3" fill="#343e8a" />
    </svg>
  );
}

export function PawPatrol({
  workspace = null,
  join = null,
}: {
  workspace?: Workspace | null;
  /** Resolved on the server from the request's own origin. */
  join?: JoinLink | null;
}) {
  const { time, running, readClock, dispatch, sceneOverride, panics, audit } = useScenario();
  // One of the two things that cross workspaces, the body camera wall being
  // the other. Both live on the server, so both need the workspaces to be one
  // process. Everything below this line is local to a browser.
  const bus = useIncidentBus();
  const [draftDismissed, setDraftDismissed] = useState(false);
  const [appliedDraft, setAppliedDraft] = useState<MistDraft | null>(null);
  const [records, setRecords] = useState<Record<string, MistRecord>>({});
  const [session, setSession] = useState(0);
  const [tactical, setTactical] = useState(emptyTactical);
  const fixedView = workspace ? WORKSPACE_VIEWS[workspace] : undefined;
  const [selectedView, setSelectedView] = useState<View>("command");
  const view = fixedView ?? selectedView;
  function setView(nextView: View) {
    if (!fixedView) setSelectedView(nextView);
  }
  const [selectedId, setSelectedId] = useState<string>("P-01");
  const [hardware, setHardware] = useState(false);
  const [evidence, setEvidence] = useState<"camera" | "audio" | null>(null);
  const person = PEOPLE.find((p) => p.id === selectedId) ?? PEOPLE[0];
  const phase = phaseAt(time),
    medical = phase >= 3,
    complete = time === DURATION;
  const selectedCase = medical && person.id === "P-01";
  const scene = sceneAt(time, sceneOverride);

  const { publish } = bus;
  /**
   * Mirrors a local action onto the shared log before applying it.
   *
   * The reducer stays the single owner of this workspace's own state; the bus
   * carries the same fact to the others. Publication is best-effort on purpose:
   * a demo whose panic button stops working because a fetch failed is worse
   * than one that tells you the workspaces are out of sync.
   */
  const sharedDispatch = useCallback(
    (action: DemoAction) => {
      const shared: Record<string, () => IncidentDraft> = {
        panic: () => ({
          id: `panic-${action.type === "panic" ? action.personId : ""}-${time}`,
          kind: "panic",
          origin: "operator",
          scenarioAt: time,
          personId: action.type === "panic" ? action.personId : null,
          title: `Assistance requested · ${action.type === "panic" ? action.personId : ""}`,
          detail:
            "Manual assistance request from the officer workspace. No injury, loss of consciousness or treatment need is claimed by this action.",
          source: "Officer workspace",
          provenance: null,
          requiresHumanReview: true,
        }),
        acknowledge: () => ({
          id: `ack-${action.type === "acknowledge" ? action.personId : ""}-${time}`,
          kind: "acknowledge",
          origin: "operator",
          scenarioAt: time,
          personId: action.type === "acknowledge" ? action.personId : null,
          title: `Acknowledged · ${action.type === "acknowledge" ? action.personId : ""}`,
          detail:
            "Command has seen the assistance request. Acknowledgement is not a scene assessment and does not authorize entry.",
          source: "Command desk",
          provenance: null,
          requiresHumanReview: false,
        }),
        scene: () => ({
          id: `scene-${action.type === "scene" ? action.status : ""}-${time}`,
          kind: "scene",
          origin: "operator",
          scenarioAt: time,
          personId: null,
          title: `Scene reported ${action.type === "scene" ? action.status : ""}`,
          detail:
            action.type === "scene" && action.status === "cleared"
              ? "Command recorded a clearance authorizing patient access in this demonstration. No real scene was assessed."
              : "EMS stages outside the scene until a clearance report is recorded.",
          source: "Command desk",
          provenance: null,
          requiresHumanReview: true,
        }),
      };
      const build = shared[action.type];
      if (build) void publish(build());
      dispatch(action);
    },
    [dispatch, publish, time],
  );

  const captureContext = useCallback(
    () => ({ personId: selectedId, scenarioAt: time, sourceLabel: "Officer body camera" }),
    [selectedId, time],
  );

  const onHazard = useCallback(
    (result: TriageResult) => {
      const incident = hazardIncident(result, captureContext());
      // Most frames carry nothing worth interrupting anyone for.
      if (incident) void publish(incident);
    },
    [captureContext, publish],
  );

  const onTranscript = useCallback(
    (result: TranscriptionResult) => {
      const incident = transcriptIncident(result, captureContext());
      if (incident) void publish(incident);
    },
    [captureContext, publish],
  );

  const modelDraft = draftMist(bus.events, person.id);
  const draftAvailable = hasDraft(modelDraft) && !draftDismissed && !records[person.id];

  const events = [
    ...EVENTS.filter((e) => e.at <= time && !(sceneOverride && e.at === 56)),
    ...audit,
  ].sort((a, b) => a.at - b.at);
  function reset() {
    dispatch({ type: "reset" });
    setSelectedId("P-01");
    setEvidence(null);
    setRecords({});
    setTactical(emptyTactical);
    setSession((s) => s + 1);
    setDraftDismissed(false);
    setAppliedDraft(null);
    // Clears the shared log in every workspace, not only this one.
    void bus.clear();
  }
  function play() {
    if (complete) {
      setRecords({});
      setTactical(emptyTactical);
      setSession((s) => s + 1);
    }
    dispatch({ type: "play" });
  }
  useDemoTools({
    view,
    fixedView,
    selectedId,
    time,
    running,
    setView,
    setSelectedId,
    dispatch,
    reset,
    play,
  });
  function inspect(p: Person) {
    setSelectedId(p.id);
    setView("officer");
  }
  const annotation = selectedCase
    ? {
        label: "Staged injury report",
        detail: "The demo script reports an injury. Site, severity and diagnosis are not provided.",
      }
    : null;

  // One map, one legend, one set of positions, in all three workspaces.
  const map = (
    <OperationsMapPanel
      time={time}
      running={running}
      readClock={readClock}
      selectedId={selectedId}
      onSelect={setSelectedId}
      resetSignal={session}
    />
  );

  return (
    <div className="paw-app">
      <a className="skip-link" href="#workspace">
        Skip to workspace
      </a>
      <header className="topbar">
        <Link className="wordmark" href="/" aria-label="Paw Patrol home">
          <Shield />
          <span>
            Paw Patrol<small>CONNECTED RESPONSE</small>
          </span>
        </Link>
        <nav aria-label="Workspace">
          {workspace ? (
            <span className="nav-item active" aria-current="page">
              {fixedView === "command" ? (
                <Radio />
              ) : fixedView === "officer" ? (
                <Shield />
              ) : (
                <HeartPulse />
              )}
              {WORKSPACE_LABELS[workspace]}
            </span>
          ) : (
            (["command", "officer", "hospital"] as const).map((v) => (
              <button
                key={v}
                className={`nav-item ${view === v ? "active" : ""}`}
                aria-pressed={view === v}
                onClick={() => setView(v)}
              >
                {v === "command" ? <Radio /> : v === "officer" ? <Shield /> : <HeartPulse />}
                {VIEW_NAMES[v]}
              </button>
            ))
          )}
        </nav>
        <button
          className="hardware-toggle"
          onClick={() => setHardware(!hardware)}
          aria-expanded={hardware}
        >
          <WifiOff size={16} />
          <span>Devices offline</span>
        </button>
      </header>
      <main id="workspace">
        <div className="page-heading">
          <div>
            <p className="eyebrow">
              {view === "command"
                ? "BOSTON & CAMBRIDGE · OPERATIONS"
                : view === "officer"
                  ? "OFFICER WORKSPACE · DESKTOP"
                  : "RECEIVING DESK · SIMULATED HOSPITAL"}
            </p>
            <h1>
              {view === "command"
                ? PHASES[phase].title
                : view === "officer"
                  ? "Never out there alone."
                  : "Ready before arrival."}
            </h1>
          </div>
          <div className="demo-buttons">
            <button
              className="primary"
              onClick={() => (running ? dispatch({ type: "pause" }) : play())}
            >
              {running ? <Pause size={16} /> : <Play size={16} />}{" "}
              {running
                ? "Pause demo"
                : complete
                  ? "Replay demo"
                  : time > 0
                    ? "Resume demo"
                    : "Run demo"}
              <ArrowUpRight size={16} />
            </button>
            <button
              className="outline-button"
              onClick={reset}
              title="Reset demo"
              aria-label="Reset demo"
            >
              <RotateCcw size={17} />
            </button>
          </div>
        </div>
        <div className="demo-notice">
          <span className="tag">SIMULATION</span>
          <span>Synthetic people and signals. No live monitoring or real dispatch.</span>
          <span className="auto-label">
            {complete
              ? "Demo complete"
              : running
                ? "Automatic sequence running"
                : time > 0
                  ? "Paused · press Resume to continue"
                  : "90-second automatic scenario"}
          </span>
        </div>
        <BusIndicator status={bus.status} count={bus.events.length} />
        <SceneCoordination
          time={time}
          scene={scene}
          person={person}
          panics={panics}
          command={view === "command"}
          dispatch={sharedDispatch}
        />
        {hardware && (
          <section className="hardware-panel panel">
            <div className="panel-heading">
              <h2>Hardware readiness</h2>
              <button
                className="icon-control"
                aria-label="Close hardware panel"
                onClick={() => setHardware(false)}
              >
                <X size={18} />
              </button>
            </div>
            <div className="hardware-grid">
              {[
                {
                  icon: Smartphone,
                  name: "iPhone 16 Pro Max",
                  purpose: "Camera · microphone · GPS",
                  state: "Not connected",
                },
                {
                  icon: Watch,
                  name: "Apple Watch SE",
                  purpose: "Heart rate · generation not specified",
                  state: "Not connected",
                },
                {
                  icon: Laptop,
                  name: "Mac",
                  purpose: "This frontend demo workspace",
                  state: "Demo only",
                },
              ].map((h) => (
                <div key={h.name}>
                  <h.icon size={23} />
                  <strong>{h.name}</strong>
                  <span>{h.purpose}</span>
                  <span className="tag">{h.state}</span>
                </div>
              ))}
            </div>
            <p className="small-note">
              The device inventory is recorded, but this build does not pair devices, run models,
              record media or collect health data.
            </p>
            <p className="small-note">
              <strong>ATAK integration · planned, not connected.</strong> A native Android plugin or
              validated TAK adapter is a separate integration. This browser demo does not send CoT
              events, tactical messages or real dispatch requests.
            </p>
          </section>
        )}

        {view !== "command" && (
          <div className="person-bar">
            <label htmlFor="person">
              Selected person <ChevronDown size={14} />
            </label>
            <select id="person" value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
              {PEOPLE.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {p.id}
                </option>
              ))}
            </select>
            <span className="tag paper">{personStatus(person.id, time)}</span>
            <span className="person-note">Fictional demo identity</span>
          </div>
        )}

        {view === "command" && (
          <div className="workspace">
            <aside className="panel units-panel">
              <div className="panel-heading">
                <h2>On the ground</h2>
                <span>04</span>
              </div>
              <p className="muted">Demo patrol units</p>
              {PEOPLE.map((p) => (
                <button
                  className={`unit ${p.id === selectedId ? "selected" : ""}`}
                  key={p.id}
                  aria-pressed={p.id === selectedId}
                  onClick={() => setSelectedId(p.id)}
                >
                  <span className={`avatar ${p.color}`}>{p.initials}</span>
                  <span className="unit-copy">
                    <strong>{p.name}</strong>
                    <small>
                      {p.id} · {p.area}
                    </small>
                    <span className="unit-status">
                      {panics.some((alert) => alert.personId === p.id)
                        ? "Panic assistance requested"
                        : personStatus(p.id, time)}
                    </span>
                  </span>
                </button>
              ))}
              <div className="selected-summary">
                <span className="eyebrow">SELECTED OFFICER</span>
                <h3>{person.name}</h3>
                <div className="reading">
                  <strong>{sampleHeartRate(person.id, time)}</strong>
                  <span>
                    bpm <small>synthetic</small>
                  </span>
                  <HeartPulse size={21} />
                </div>
                {!workspace && (
                  <button className="text-button" onClick={() => inspect(person)}>
                    Open officer & body view <ArrowUpRight size={15} />
                  </button>
                )}
              </div>
              <JoinCard join={join} />
            </aside>
            {map}
            <aside className="panel incident-panel">
              <TacticalBrief time={time} report={tactical} setReport={setTactical} />
              <p className="eyebrow">RESPONSE DESK {phase > 0 ? "· DEMO-001" : ""}</p>
              <h2>
                {phase === 0 ? (
                  <>
                    Ready when
                    <br />
                    it matters.
                  </>
                ) : phase < 3 ? (
                  "Quiet signal. Fast support."
                ) : (
                  "Care in motion."
                )}
              </h2>
              <div className={`incident-callout ${phase > 0 ? "active-incident" : ""}`}>
                <span className={`tag ${phase === 0 ? "sage" : phase < 3 ? "apricot" : "sky"}`}>
                  {phase === 0
                    ? "STANDBY"
                    : phase < 3
                      ? "UNVERIFIED SIGNAL"
                      : "STAGED MEDICAL EVENT"}
                </span>
                <p>{PHASES[phase].detail}</p>
              </div>
              <dl className="details">
                <div>
                  <dt>Location</dt>
                  <dd>Kendall Square</dd>
                </div>
                <div>
                  <dt>Primary unit</dt>
                  <dd>P-01 · Alex Morgan</dd>
                </div>
                <div>
                  <dt>Backup</dt>
                  <dd>{phase >= 2 ? "P-02 + P-03 assigned" : "Not requested"}</dd>
                </div>
                <div>
                  <dt>Medical</dt>
                  <dd>
                    {time >= 52
                      ? "EMS-01 · simulated"
                      : medical
                        ? "Coordinating in demo"
                        : "No injury reported"}
                  </dd>
                </div>
              </dl>
              <div className="evidence-buttons">
                <button
                  onClick={() => setEvidence(evidence === "camera" ? null : "camera")}
                  aria-expanded={evidence === "camera"}
                >
                  <Camera size={16} />
                  Camera
                </button>
                <button
                  onClick={() => setEvidence(evidence === "audio" ? null : "audio")}
                  aria-expanded={evidence === "audio"}
                >
                  <Mic size={16} />
                  Audio
                </button>
              </div>
              {!workspace && (
                <button
                  className="text-button"
                  onClick={() => {
                    setSelectedId("P-01");
                    setView("hospital");
                  }}
                >
                  View hospital handoff <ArrowRight size={15} />
                </button>
              )}
            </aside>
          </div>
        )}

        {view === "officer" && (
          <>
            <div className="officer-summary">
              <section className="panel assignment">
                <p className="eyebrow">{person.id} · ASSIGNMENT</p>
                <h2>{person.area} patrol</h2>
                <p className="prose">
                  {person.id === "P-01"
                    ? phase === 0
                      ? "Stay connected to your team. Your surroundings and status, in one place."
                      : PHASES[phase].detail
                    : personStatus(person.id, time) === "On patrol"
                      ? "Continue the assigned patrol. The sample unit is available to the command desk."
                      : "Responding to the staged incident near Kendall Square. Assignment is simulated."}
                </p>
              </section>
              <section className="panel vital-card">
                <div className="panel-heading">
                  <h3>Heart rate</h3>
                  <HeartPulse size={20} />
                </div>
                <div className="reading">
                  <strong>{sampleHeartRate(person.id, time)}</strong>
                  <span>
                    bpm<small>Synthetic sample · {stamp(time)}</small>
                  </span>
                </div>
                <HeartChart time={time} id={person.id} />
              </section>
              <section className="panel support-card">
                <p className="eyebrow">INCIDENT RESPONSE UNITS</p>
                <h3>{phase >= 2 ? "Support for P-01." : "Available for response."}</h3>
                <div className="support-avatars">
                  <span className="avatar sage">JL</span>
                  <span className="avatar sky">SR</span>
                  <span>
                    P-02 & P-03
                    <br />
                    <small>
                      {phase >= 3
                        ? "At staged scene"
                        : phase >= 2
                          ? "On illustrative response paths"
                          : "Available in demo"}
                    </small>
                  </span>
                </div>
              </section>
            </div>
            <div className="officer-grid">
              {map}
              <AnatomyViewer
                personId={person.id}
                personName={person.name}
                annotation={annotation}
              />
            </div>
            <section className="panel evidence-panel">
              <div className="panel-heading">
                <h2>Body camera · live</h2>
                <span className="tag">REAL CAPTURE</span>
              </div>
              <div className="evidence-content">
                <Camera size={34} />
                <div>
                  <h3>This camera opens the incident</h3>
                  <p>
                    Frames from this device go to the triage service. A reported weapon or person
                    down publishes to the shared log, so Command and the receiving desk see it
                    without a radio call. The service has no &quot;safe&quot; result to return and
                    every output needs a person to review it.
                  </p>
                </div>
              </div>
              <div className="evidence-capture">
                <CapturePanel
                  sourceId={`officer-${person.id}`}
                  onResult={onHazard}
                  onTranscript={onTranscript}
                />
              </div>
            </section>
            <section className="panel device-strip">
              <Smartphone size={20} />
              <strong>iPhone 16 Pro Max</strong>
              <span>Video, audio & GPS not connected</span>
              <Watch size={20} />
              <strong>Apple Watch SE</strong>
              <span>Heart-rate feed not connected</span>
            </section>
          </>
        )}

        {view === "hospital" && (
          <div className="hospital-grid">
            {/* The receiving desk sees the same picture as the other two: where
                the units are, and where the report places the person of
                interest. It is context for an arrival, not a clinical input. */}
            {map}
            <section className="panel handoff-panel">
              <div className="panel-heading">
                <span className={`tag ${selectedCase ? "sky" : "sage"}`}>
                  {selectedCase
                    ? complete
                      ? "HANDOFF COMPLETE"
                      : "SIMULATED INCOMING"
                    : "STANDBY"}
                </span>
                <Ambulance size={25} />
              </div>
              <h2>{selectedCase ? person.name : "Awaiting a handoff."}</h2>
              <p className="prose">
                {selectedCase
                  ? "A single view of the staged incident and sample observations. No clinical assessment has been performed."
                  : `No injury or incoming transfer is reported for ${person.name} in the current scenario.`}
              </p>
              {selectedCase ? (
                <>
                  <PreArrival
                    time={time}
                    duration={DURATION}
                    arrived={complete}
                    landed={[
                      { label: "Scene status reported", present: scene.status !== "unknown" },
                      {
                        label: "Mechanism drafted from scene camera",
                        present: Boolean(modelDraft.mechanism),
                      },
                      { label: "Scene audio reviewed", present: Boolean(modelDraft.symptoms) },
                      { label: "Heart-rate series available", present: true },
                      {
                        label: "Clinician-entered handoff saved",
                        present: Boolean(records[person.id]),
                      },
                    ]}
                  />
                  <dl className="details">
                    <div>
                      <dt>Demo case</dt>
                      <dd>DEMO-001 / P-01</dd>
                    </div>
                    <div>
                      <dt>Transport</dt>
                      <dd>{emsStatus(time, scene.status)}</dd>
                    </div>
                    <div>
                      <dt>Destination</dt>
                      <dd>Demo receiving point, Cambridge</dd>
                    </div>
                    <div>
                      <dt>Injury site</dt>
                      <dd>Not provided</dd>
                    </div>
                    <div>
                      <dt>Diagnosis</dt>
                      <dd>Not assessed</dd>
                    </div>
                    <div>
                      <dt>History / allergies</dt>
                      <dd>Not provided</dd>
                    </div>
                  </dl>
                  <div className="handoff-note">
                    <Info size={17} />
                    <p>
                      Unverified weapon report remains unconfirmed. Heart-rate changes do not
                      establish an injury or a diagnosis.
                    </p>
                  </div>
                </>
              ) : (
                <div className="empty-handoff">
                  <HeartPulse size={48} />
                  <p>
                    When the demo reaches its explicit injury event, the handoff for Alex Morgan
                    appears here automatically.
                  </p>
                  <button className="secondary" onClick={() => setSelectedId("P-01")}>
                    Select primary officer
                  </button>
                </div>
              )}
            </section>
            <AnatomyViewer personId={person.id} personName={person.name} annotation={annotation} />
            <section className="panel observations">
              <p className="eyebrow">SAMPLE OBSERVATIONS</p>
              <h2>Context, not conclusions.</h2>
              <div className="reading">
                <strong>{sampleHeartRate(person.id, time)}</strong>
                <span>
                  bpm<small>Scripted heart rate</small>
                </span>
              </div>
              <HeartChart time={time} id={person.id} />
              <p className="small-note">
                No measurements received from a watch. No live blood pressure, oxygen saturation,
                ECG or diagnosis is available.
              </p>
              <h3 className="section-label">Handoff contents</h3>
              {[
                "Scenario event timeline",
                "Sample heart-rate series",
                "Scripted transport status",
              ].map((s) => (
                <div className="check-row" key={s}>
                  <Check size={16} />
                  {s}
                </div>
              ))}
              <div className="feed-unavailable">
                <Camera size={23} />
                <strong>No body-camera footage</strong>
                <p>No recording was supplied. A detection result is not a visual confirmation.</p>
              </div>
              <p className="small-note">
                All people and coordination are simulated. No hospital was contacted.
              </p>
            </section>
          </div>
        )}

        {view === "hospital" && selectedCase && (
          <>
            {draftAvailable && (
              <MistDraftCard
                draft={modelDraft}
                onApply={() => setAppliedDraft(modelDraft)}
                onDismiss={() => setDraftDismissed(true)}
              />
            )}
            <MistHandoff
              // Remounting is what seeds the editable form from an applied
              // draft; the form owns its state once a person is typing in it.
              key={`${session}-${person.id}-${appliedDraft ? "drafted" : "blank"}`}
              person={person}
              time={time}
              scene={scene}
              saved={records[person.id]}
              seed={appliedDraft}
              onSave={(record) => setRecords((current) => ({ ...current, [person.id]: record }))}
            />
          </>
        )}

        {view === "hospital" && (
          <NotConcluded
            events={bus.events}
            personId={person.id}
            hasSavedRecord={Boolean(records[person.id])}
          />
        )}

        {evidence && view === "command" && (
          <section className="panel evidence-panel">
            <div className="panel-heading">
              <h2>{evidence === "camera" ? "Camera evidence" : "Audio evidence"}</h2>
              <button
                className="icon-control"
                aria-label="Close evidence"
                onClick={() => setEvidence(null)}
              >
                <X size={18} />
              </button>
            </div>
            <div className="evidence-content">
              {evidence === "camera" ? <Camera size={34} /> : <Mic size={34} />}
              <div>
                <h3>The {evidence === "camera" ? "weapon" : "concern"} signal is scripted</h3>
                <p>
                  That event came from the demo timeline, not from a sensor. Capture below is
                  separate and real: this device&apos;s{" "}
                  {evidence === "camera" ? "camera" : "microphone"} feeds the triage service, and
                  what comes back is a model reading for a person to check.
                </p>
              </div>
              <span className="tag">DEMO SIGNAL ONLY</span>
            </div>
            <div className="evidence-capture">
              <CapturePanel sourceId={`dispatch-${evidence}`} />
            </div>
          </section>
        )}

        {/* Command watches every officer publishing, not just this device. */}
        {view === "command" && <BodyCamWall />}

        <section className="scenario-strip" aria-label="Demo playback">
          <div className="scenario-caption">
            <span className="eyebrow">THE RESPONSE CHAIN</span>
            <span className="clock">
              {stamp(time)} <small>/ 01:30</small>
            </span>
            <button
              className="next-button"
              disabled={complete}
              onClick={() => dispatch({ type: "next" })}
            >
              Next stage <SkipForward size={15} />
            </button>
          </div>
          <ol className="phases">
            {PHASES.map((p, i) => (
              <li key={p.label} className={phase === i ? "current" : phase > i ? "done" : ""}>
                <span>{phase > i ? <Check size={14} /> : String(i + 1).padStart(2, "0")}</span>
                <strong>{p.label}</strong>
                <small>{stamp(p.at)}</small>
              </li>
            ))}
          </ol>
          <div className="progress-track">
            <div style={{ width: `${(time / DURATION) * 100}%` }} />
          </div>
        </section>
        <section className="activity-panel panel">
          <div className="panel-heading">
            <h2>Shared incident log</h2>
            <span className="tag">ALL WORKSPACES</span>
          </div>
          <SharedTimeline events={bus.events} />
        </section>
        <section className="activity-panel panel">
          <div className="panel-heading">
            <h2>Event timeline</h2>
            <span className="tag">SCRIPTED EVENTS</span>
          </div>
          <div className="activity-list">
            {[...events].reverse().map((e) => (
              <article key={"id" in e ? String(e.id) : `${e.at}-${e.title}`}>
                <time>{stamp(e.at)}</time>
                <div>
                  <strong>{e.title}</strong>
                  <p>{e.detail}</p>
                </div>
                <span>{e.source}</span>
              </article>
            ))}
          </div>
        </section>
        <p className="sr-only" role="status">
          {PHASES[phase].label}: {PHASES[phase].detail}
        </p>
      </main>
      <footer>
        <span>PAW PATROL · HACKMIT 2026</span>
        <span>Frontend demo · No external dispatch or clinical decisions</span>
      </footer>
    </div>
  );
}
