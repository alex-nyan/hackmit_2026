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
  ArrowUpRight,
  MapPin,
  Camera,
  Mic,
  Watch,
  Smartphone,
  Laptop,
  X,
  LocateFixed,
  Sun,
  Moon,
  Check,
  ArrowRight,
  Ambulance,
  WifiOff,
  Info,
  ChevronDown,
} from "lucide-react";
import { type MapFocus, type MapTheme, MAP_FOCUS } from "../boston-map/types";
import { BuildingPanel } from "../boston-map/BuildingPanel";
import type { BuildingFacts } from "../boston-map/buildingSelection";
import { CapturePanel } from "@/features/camera-triage";
import { LiveTrackPanel, useLiveTrack, type LiveDevice } from "@/features/live-track";
import { OperationsMap } from "./OperationsMap";
import { WorkspaceMapShell } from "./WorkspaceMapShell";
import officerStyles from "./OfficerWorkspace.module.css";
import {
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
import { vehicleAt } from "./vehicles/vehicleMotion";
import { useDemoTools } from "./useDemoTools";
import { sceneAt, emsStatus, type MistRecord } from "./consult";
import { SceneCoordination, TacticalBrief, MistHandoff, emptyTactical } from "./ConsultPanels";
import { WORKSPACE_LABELS, WORKSPACE_VIEWS, type Workspace } from "./workspace";
import { useIncidentBus } from "./useIncidentBus";
import { hazardIncident, transcriptIncident } from "./hazardSignal";
import { draftMist, hasDraft, type MistDraft } from "./draftMist";
import type { IncidentDraft } from "./incidents";
import { BusIndicator, MistDraftCard, NotConcluded, SharedTimeline } from "./Provenance";
import type { TriageResult } from "../camera-triage/types";
import type { TranscriptionResult } from "../camera-triage/audio";
import { HeartRatePanel } from "../heart-rate/HeartRatePanel";
import {
  useHeartRate,
  type HeartRateConnection,
  type HeartRateSample,
} from "../heart-rate/useHeartRate";

const AnatomyViewer = dynamic(() => import("../anatomy/AnatomyViewer"), {
  ssr: false,
  loading: () => (
    <div className="model-pending" role="status">
      Preparing anatomy viewer…
    </div>
  ),
});
/** Stable identity so a poll that finds nothing does not rerun the map effect. */
const EMPTY_DEVICES: LiveDevice[] = [];

const VIEW_NAMES = {
  command: "Command",
  officer: "Officer",
  hospital: "Hospital",
};

function HeartChart({
  time,
  id,
  deviceSamples,
}: {
  time: number;
  id: string;
  deviceSamples?: HeartRateSample[];
}) {
  const values =
    deviceSamples?.map((sample) => sample.bpm) ??
    Array.from({ length: 24 }, (_, i) => sampleHeartRate(id, Math.max(0, time - (23 - i) * 2)));
  if (deviceSamples && deviceSamples.length < 2) {
    return (
      <p className="small-note">
        The device trend appears after two readings. No synthetic points are added.
      </p>
    );
  }
  const minimum = Math.min(...values) - 5;
  const range = Math.max(...values) + 5 - minimum;
  const y = (value: number) =>
    deviceSamples ? 75 - ((value - minimum) / range) * 65 : 80 - (value - 65) * 0.85;
  const firstAt = deviceSamples?.[0]?.receivedAt ?? 0;
  const elapsed = (deviceSamples?.at(-1)?.receivedAt ?? 0) - firstAt;
  const x = (index: number) =>
    deviceSamples && elapsed > 0
      ? ((deviceSamples[index].receivedAt - firstAt) / elapsed) * 230
      : (index / Math.max(1, values.length - 1)) * 230;
  const path = values.map((value, i) => `${x(i)},${y(value)}`).join(" ");
  return (
    <svg
      className="heart-chart"
      viewBox="0 0 230 84"
      role="img"
      aria-label={deviceSamples ? "Received heart rate trend" : "Synthetic heart rate trend"}
    >
      <title>
        {deviceSamples
          ? "Past device readings by browser receipt time; not an ECG"
          : "Synthetic scenario readings"}
      </title>
      <path d="M0 75H230M0 40H230M0 5H230" stroke="#dedfd9" strokeWidth="1" />
      <polyline
        points={path}
        fill="none"
        stroke="#343e8a"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      <circle cx="230" cy={y(values[values.length - 1])} r="3" fill="#343e8a" />
    </svg>
  );
}

function HeartRateReadout({
  connection,
  time,
  personId,
}: {
  connection: HeartRateConnection;
  time: number;
  personId: string;
}) {
  const deviceMode = connection.mode === "device";
  const current = connection.status === "receiving" ? connection.bpm : null;
  return (
    <div className="reading" aria-label="Selected person heart rate">
      <strong>{deviceMode ? (current ?? "--") : sampleHeartRate(personId, time)}</strong>
      <span>
        bpm
        <small>
          {deviceMode
            ? current !== null
              ? "Live device reading"
              : "Device test · no current reading"
            : `Synthetic sample · ${stamp(time)}`}
        </small>
      </span>
    </div>
  );
}

export function PawPatrol({
  workspace = null,
  presentation = "map",
}: {
  workspace?: Workspace | null;
  /** Retain existing detail workflows for later UI work and regression coverage. */
  presentation?: "map" | "detailed";
}) {
  const { time, running, readClock, dispatch, sceneOverride, panics, audit } = useScenario();
  // The only state shared across workspaces. Everything else stays local.
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
  const [focus, setFocus] = useState<MapFocus>("all");
  const [theme, setTheme] = useState<MapTheme>("light");
  const [recenterKey, setRecenterKey] = useState(0);
  const [following, setFollowing] = useState(false);
  const [hardware, setHardware] = useState(false);
  const [evidence, setEvidence] = useState<"camera" | "audio" | null>(null);
  // Both are opt-in: no camera, microphone or tracking request until asked.
  const [tracking, setTracking] = useState(false);
  const liveTrack = useLiveTrack(tracking);
  const liveDevices = liveTrack.state === "tracking" ? liveTrack.devices : EMPTY_DEVICES;
  const [building, setBuilding] = useState<BuildingFacts | null>(null);
  const handleBuildingSelect = useCallback((next: BuildingFacts | null) => setBuilding(next), []);
  const [fixRequest, setFixRequest] = useState<{
    longitude: number;
    latitude: number;
    nonce: number;
  } | null>(null);
  // The nonce is what makes a repeat click move the camera again.
  const handleFocusDevice = useCallback((device: LiveDevice) => {
    if (!device.fix) return;
    setFollowing(false);
    setFixRequest((previous) => ({
      longitude: device.fix!.longitude,
      latitude: device.fix!.latitude,
      nonce: (previous?.nonce ?? 0) + 1,
    }));
  }, []);
  const person = PEOPLE.find((p) => p.id === selectedId) ?? PEOPLE[0];
  // Local-only: never pass device readings to the incident bus or MIST records.
  const heartRate = useHeartRate(person.id, session);
  const vehicle = vehicleAt(person.id, time);
  const phase = phaseAt(time),
    medical = phase >= 3,
    complete = false;
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

  const events = [...EVENTS, ...audit].sort((a, b) => a.at - b.at);
  function reset() {
    dispatch({ type: "reset" });
    setSelectedId("P-01");
    setFollowing(false);
    setFocus("all");
    setRecenterKey((k) => k + 1);
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

  const map = (
    <section className="map-panel" aria-label="Operations map">
      <div className="map-heading">
        <span>
          <MapPin size={16} />
          Boston & Cambridge
        </span>
        <div className="map-actions">
          <button
            className="follow-control"
            disabled={!vehicle.routeId}
            aria-pressed={following}
            title={
              following
                ? "Stop following. You can also drag the map."
                : "Keep the selected patrol vehicle centred"
            }
            onClick={() => setFollowing((value) => !value)}
          >
            <LocateFixed size={14} aria-hidden="true" />
            {following ? "Stop following" : `Follow ${person.id}`}
          </button>
          <button
            className="icon-control"
            title="Centre selected officer"
            aria-label="Centre selected officer"
            onClick={() => setRecenterKey((k) => k + 1)}
          >
            <LocateFixed size={17} />
          </button>
          <button
            className="icon-control"
            data-on={tracking ? "true" : undefined}
            aria-pressed={tracking}
            title={tracking ? "Stop live tracking" : "Show real tracked units"}
            aria-label={tracking ? "Stop live tracking" : "Show real tracked units"}
            onClick={() => setTracking((value) => !value)}
          >
            {tracking ? <LocateFixed size={17} /> : <WifiOff size={17} />}
          </button>
          <button
            className="icon-control"
            title="Toggle map theme"
            aria-label="Toggle map theme"
            onClick={() => setTheme((t) => (t === "light" ? "dark" : "light"))}
          >
            {theme === "light" ? <Moon size={17} /> : <Sun size={17} />}
          </button>
        </div>
      </div>
      <div className="map-wrapper">
        <OperationsMap
          time={time}
          running={running}
          readClock={readClock}
          selectedId={selectedId}
          onSelect={setSelectedId}
          focus={focus}
          theme={theme}
          recenterKey={recenterKey}
          following={following}
          onStopFollowing={() => setFollowing(false)}
          liveDevices={liveDevices}
          fixRequest={fixRequest}
          onBuildingSelect={handleBuildingSelect}
        />
        <div className="map-overlay">
          <LiveTrackPanel state={liveTrack} onFocusDevice={handleFocusDevice} />
          <BuildingPanel building={building} onDismiss={() => setBuilding(null)} />
        </div>
        <div className="campus-switch" aria-label="Map area">
          {Object.entries(MAP_FOCUS).map(([key, target]) => (
            <button
              key={key}
              aria-pressed={focus === key}
              onClick={() => {
                setFollowing(false);
                setFocus(key as MapFocus);
              }}
            >
              {target.label}
            </button>
          ))}
        </div>
      </div>
      {view !== "officer" && presentation === "detailed" && (
        <>
          <div className="vehicle-telemetry" aria-label="Selected unit simulated position">
            <span>
              <strong>{person.id}</strong> {personStatus(person.id, time)}
            </span>
            <span>
              {vehicle.routeId ? `${Math.round(vehicle.speedMps * 3.6)} km/h` : "Route unavailable"}
            </span>
            {vehicle.routeId && (
              <span className="vehicle-coordinates">
                {vehicle.point[1].toFixed(5)}, {vehicle.point[0].toFixed(5)}
              </span>
            )}
          </div>
          <div className="map-legend">
            <span>
              <i className="legend-officer" />
              Simulated patrol
            </span>
          </div>
        </>
      )}
    </section>
  );

  // Keep the shared state/subscription above mounted, but do not mount legacy
  // panels (especially capture) in the new Dispatch/Medic presentation.
  // Officer capture callbacks and all backend/live-mode paths remain unchanged.
  if (view !== "officer" && presentation === "map") {
    return (
      <WorkspaceMapShell
        workspace={workspace}
        view={view}
        onViewChange={setView}
        selectedId={selectedId}
        onSelect={setSelectedId}
        status={personStatus(person.id, time)}
        map={map}
      />
    );
  }

  return (
    <div className={`paw-app ${view === "officer" ? officerStyles.officer : ""}`}>
      <a className="skip-link" href="#workspace">
        Skip to workspace
      </a>
      <header className="topbar">
        <Link className="wordmark" href="/" aria-label="Paw Patrol home">
          <Shield />
          <span>Paw Patrol{view !== "officer" && <small>CONNECTED RESPONSE</small>}</span>
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
          aria-label={view === "officer" ? "Devices" : "Devices offline"}
          onClick={() => setHardware(!hardware)}
          aria-expanded={hardware}
        >
          <Watch size={16} />
          <span>
            {heartRate.status === "receiving" ? "Heart rate live" : "Devices & HeartCast"}
          </span>
        </button>
      </header>
      <main id="workspace">
        {view !== "officer" && (
          <>
            <div className="page-heading">
              <div>
                <p className="eyebrow">
                  {view === "command"
                    ? "BOSTON & CAMBRIDGE · OPERATIONS"
                    : "RECEIVING DESK · SIMULATED HOSPITAL"}
                </p>
                <h1>{view === "command" ? PHASES[phase].title : "Ready before arrival."}</h1>
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
              <span>15 simulated patrol vehicles.</span>
              <span className="auto-label">
                {complete
                  ? "Demo complete"
                  : running
                    ? "Patrol running"
                    : time > 0
                      ? "Paused · press Resume to continue"
                      : "15 units · continuous patrol"}
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
          </>
        )}
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
            {view === "officer" && (
              <>
                <HeartRateReadout connection={heartRate} time={time} personId={person.id} />
                <HeartChart
                  time={time}
                  id={person.id}
                  deviceSamples={heartRate.mode === "device" ? heartRate.history : undefined}
                />
                <HeartRatePanel
                  connection={heartRate}
                  personId={person.id}
                  personName={person.name}
                />
              </>
            )}
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
                  purpose: "Heart rate via iPhone HeartCast · optional local test",
                  state: heartRate.mode === "device" ? heartRate.status : "Not connected",
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
              HeartCast can provide heart rate after you choose a Bluetooth device. Readings stay in
              this tab’s memory and are not uploaded or saved. Camera, microphone and tracking use
              separate opt-in controls; Bluetooth readings are never added to their shared incident
              log.
            </p>
            <p className="small-note">
              <strong>ATAK integration · planned, not connected.</strong> A native Android plugin or
              validated TAK adapter is a separate integration. This browser demo does not send CoT
              events, tactical messages or real dispatch requests.
            </p>
          </section>
        )}

        {view === "hospital" && (
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
                <span>{PEOPLE.length}</span>
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
                <HeartRateReadout connection={heartRate} time={time} personId={person.id} />
                <HeartRatePanel
                  connection={heartRate}
                  personId={person.id}
                  personName={person.name}
                  compact
                />
                {!workspace && (
                  <button className="text-button" onClick={() => inspect(person)}>
                    Open officer & body view <ArrowUpRight size={15} />
                  </button>
                )}
              </div>
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
                  <dt>Patrol area</dt>
                  <dd>{person.area}</dd>
                </div>
                <div>
                  <dt>Selected unit</dt>
                  <dd>
                    {person.id} · {person.name}
                  </dd>
                </div>
                <div>
                  <dt>Backup</dt>
                  <dd>{phase >= 2 ? "P-02 + P-03 assigned" : "Not requested"}</dd>
                </div>
                <div>
                  <dt>Medical</dt>
                  <dd>No injury reported</dd>
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
            <h1 className="sr-only">Officer workspace</h1>
            {map}
            <div className={officerStyles.unitPicker}>
              <Shield size={18} aria-hidden="true" />
              <label className="sr-only" htmlFor="officer-person">
                Selected person
              </label>
              <select
                id="officer-person"
                value={selectedId}
                onChange={(e) => setSelectedId(e.target.value)}
              >
                {PEOPLE.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.id} · {p.name}
                  </option>
                ))}
              </select>
              <span>{personStatus(person.id, time)}</span>
            </div>
            <div className={officerStyles.tools}>
              <button
                aria-expanded={evidence === "camera"}
                aria-controls="officer-camera"
                onClick={() => setEvidence(evidence === "camera" ? null : "camera")}
              >
                <Camera size={17} /> Camera
              </button>
              <button onClick={() => (running ? dispatch({ type: "pause" }) : play())}>
                {running ? <Pause size={17} /> : <Play size={17} />}
                {running
                  ? "Pause demo"
                  : complete
                    ? "Replay demo"
                    : time > 0
                      ? "Resume demo"
                      : "Run demo"}
              </button>
              <button aria-label="Reset demo" title="Reset demo" onClick={reset}>
                <RotateCcw size={17} />
              </button>
            </div>
            <section
              id="officer-camera"
              className={officerStyles.camera}
              hidden={evidence !== "camera"}
            >
              <div className="panel-heading">
                <h2>Camera & audio</h2>
                <button
                  className="icon-control"
                  aria-label="Close camera"
                  onClick={() => setEvidence(null)}
                >
                  <X size={18} />
                </button>
              </div>
              <CapturePanel
                sourceId={`officer-${person.id}`}
                onResult={onHazard}
                onTranscript={onTranscript}
              />
            </section>
          </>
        )}

        {view === "hospital" && (
          <div className="hospital-grid">
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
                  <p>No incoming transfer. Patrol playback does not generate medical events.</p>
                  <button className="secondary" onClick={() => setSelectedId("P-01")}>
                    Select primary officer
                  </button>
                </div>
              )}
            </section>
            <AnatomyViewer personId={person.id} personName={person.name} annotation={annotation} />
            <section className="panel observations">
              <p className="eyebrow">
                {heartRate.mode === "device" ? "LOCAL DEVICE TEST" : "SAMPLE OBSERVATIONS"}
              </p>
              <h2>Context, not conclusions.</h2>
              <HeartRateReadout connection={heartRate} time={time} personId={person.id} />
              <HeartChart
                time={time}
                id={person.id}
                deviceSamples={heartRate.mode === "device" ? heartRate.history : undefined}
              />
              <HeartRatePanel
                connection={heartRate}
                personId={person.id}
                personName={person.name}
              />
              <p className="small-note">
                Bluetooth heart rate is a local connectivity test, not a clinical assessment. No
                live blood pressure, oxygen saturation, ECG or diagnosis is available. Device
                readings are excluded from the simulated MIST handoff and shared log.
              </p>
              <h3 className="section-label">Handoff contents</h3>
              {[
                "Operator reports",
                "Synthetic heart-rate series in demo MIST only",
                "Recorded transport status",
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
                <h3>{evidence === "camera" ? "Camera capture" : "Audio capture"}</h3>
                <p>Start capture to review readings from this device.</p>
              </div>
            </div>
            <div className="evidence-capture">
              <CapturePanel sourceId={`dispatch-${evidence}`} />
            </div>
          </section>
        )}

        {view !== "officer" && (
          <>
            <section className="scenario-strip" aria-label="Demo playback">
              <div className="scenario-caption">
                <span className="eyebrow">15 UNITS · CONTINUOUS PATROL</span>
                <span className="clock">{stamp(time)}</span>
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
                <span className="tag">OPERATOR ACTIONS</span>
              </div>
              <div className="activity-list">
                {events.length === 0 && <p>No operator actions recorded.</p>}
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
          </>
        )}
        <p className="sr-only" role="status">
          {PHASES[phase].label}: {PHASES[phase].detail}
        </p>
      </main>
      {view !== "officer" && (
        <footer>
          <span>PAW PATROL · HACKMIT 2026</span>
          <span>Frontend demo · No external dispatch or clinical decisions</span>
        </footer>
      )}
    </div>
  );
}
