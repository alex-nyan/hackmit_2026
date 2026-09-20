"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import {
  Shield,
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
  ArrowRight,
  WifiOff,
} from "lucide-react";
import { type MapFocus, type MapTheme, MAP_FOCUS } from "../boston-map/types";
import { BuildingPanel } from "../boston-map/BuildingPanel";
import type { BuildingFacts } from "../boston-map/buildingSelection";
import { CapturePanel } from "@/features/camera-triage";
import { LiveTrackPanel, UnitCard, useLiveTrack, type LiveDevice } from "@/features/live-track";
import { JoinCard, type JoinLink } from "@/features/join";
import { OperationsMap } from "./OperationsMap";
import { WorkspaceMapShell } from "./WorkspaceMapShell";
import { OfficerOverview } from "./OfficerOverview";
import { GlassEffect } from "@/components/ui/liquid-glass";
import glassStyles from "./OfficerGlass.module.css";
import { WorkspaceNav } from "./WorkspaceNav";
import officerStyles from "./OfficerWorkspace.module.css";
import hospitalStyles from "./HospitalWorkspace.module.css";
import { HospitalWorkspace } from "./HospitalWorkspace";
import type { OfficerMediaInput } from "./OfficerFeed";
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
import { sceneAt } from "./consult";
import { SceneCoordination, TacticalBrief, emptyTactical } from "./ConsultPanels";
import { WORKSPACE_LABELS, WORKSPACE_VIEWS, type Workspace } from "./workspace";
import { useIncidentBus } from "./useIncidentBus";
import { hazardIncident, transcriptIncident } from "./hazardSignal";
import type { IncidentDraft } from "./incidents";
import { BusIndicator, SharedTimeline } from "./Provenance";
import type { TriageResult } from "../camera-triage/types";
import type { TranscriptionResult } from "../camera-triage/audio";
import { HeartRatePanel } from "../heart-rate/HeartRatePanel";
import {
  useHeartRate,
  type HeartRateConnection,
  type HeartRateSample,
} from "../heart-rate/useHeartRate";

/** Stable identity so a poll that finds nothing does not rerun the map effect. */
const EMPTY_DEVICES: LiveDevice[] = [];

const VIEW_NAMES: Record<View, string> = {
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
  officerMedia,
  presentation = "map",
  join = null,
}: {
  workspace?: Workspace | null;
  officerMedia?: OfficerMediaInput | null;
  /** Dispatch defaults to the map; retain its detailed workflows for regression coverage. */
  presentation?: "map" | "detailed";
  /** Resolved on the server from the request's own origin. */
  join?: JoinLink | null;
}) {
  const { time, running, readClock, dispatch, sceneOverride, panics, audit } = useScenario();
  // The only state shared across workspaces. Everything else stays local.
  const bus = useIncidentBus();
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
  // The camera and microphone stay opt-in. Tracking does not: it was opt-in
  // when it meant reaching out to a Traccar server holding credentials
  // somewhere else, and the positions now come from this deployment's own
  // store — with a join code on screen inviting people to publish into it.
  // Left off, a phone could scan, join and publish and still appear nowhere.
  const [tracking, setTracking] = useState(true);
  const liveTrack = useLiveTrack(tracking);
  const liveDevices = liveTrack.state === "tracking" ? liveTrack.devices : EMPTY_DEVICES;
  const [building, setBuilding] = useState<BuildingFacts | null>(null);
  const handleBuildingSelect = useCallback((next: BuildingFacts | null) => setBuilding(next), []);
  const [fixRequest, setFixRequest] = useState<{
    longitude: number;
    latitude: number;
    nonce: number;
  } | null>(null);
  // Which unit is open, by id rather than by value: the roster is replaced
  // wholesale on every poll, so holding the device itself would pin the card to
  // a fix from five seconds ago.
  const [openDeviceId, setOpenDeviceId] = useState<string | null>(null);
  // A unit that stops publishing leaves the roster, and its card leaves with
  // it. That is the honest outcome — there is nothing left to describe.
  const openDevice = liveDevices.find((device) => device.id === openDeviceId) ?? null;
  // The nonce is what makes a repeat click move the camera again.
  const handleFocusDevice = useCallback((device: LiveDevice) => {
    // Opening the card does not depend on having a fix; centring the map does.
    setOpenDeviceId(device.id);
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
  const phase = phaseAt(time);
  const complete = false;
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

  const events = [...EVENTS, ...audit].sort((a, b) => a.at - b.at);
  function reset() {
    dispatch({ type: "reset" });
    setSelectedId("P-01");
    setFollowing(false);
    setFocus("all");
    setRecenterKey((k) => k + 1);
    setEvidence(null);
    setTactical(emptyTactical);
    setSession((s) => s + 1);
    // Clears the shared log in every workspace, not only this one.
    void bus.clear();
  }
  function play() {
    if (complete) {
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
  const map = (
    <section className="map-panel" aria-label="Operations map">
      <div className={`map-heading ${view === "officer" ? glassStyles.bubble : ""}`}>
        {view === "officer" && <GlassEffect />}
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
          appearance={view === "officer" ? "glass" : "default"}
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
          onSelectLiveDevice={setOpenDeviceId}
          onBuildingSelect={handleBuildingSelect}
        />
        {view !== "officer" && (
          <div className="map-overlay">
            <LiveTrackPanel state={liveTrack} onFocusDevice={handleFocusDevice} />
            {openDevice && (
              <UnitCard
                device={openDevice}
                heartRate={heartRate}
                onDismiss={() => setOpenDeviceId(null)}
              />
            )}
            {view === "command" && <JoinCard join={join} />}
            <BuildingPanel building={building} onDismiss={() => setBuilding(null)} />
          </div>
        )}
        <div
          className={`campus-switch ${view === "officer" ? `${glassStyles.bubble} ${glassStyles.pill}` : ""}`}
          aria-label="Map area"
        >
          {view === "officer" && <GlassEffect />}
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
      {view === "command" && presentation === "detailed" && (
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
  // panels (especially capture) in the new Dispatch presentation.
  // Hospital keeps its dedicated camera and heart-rate overlay.
  // Officer capture callbacks and all backend/live-mode paths remain unchanged.
  if (view === "command" && presentation === "map") {
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
    <div
      className={`paw-app ${view === "officer" ? `${officerStyles.officer} ${glassStyles.workspace}` : view === "hospital" ? hospitalStyles.hospital : ""}`}
      data-officer-glass={view === "officer" ? "true" : undefined}
      data-officer-theme={view === "officer" ? theme : undefined}
    >
      <a className="skip-link" href="#workspace">
        Skip to workspace
      </a>
      <header className={`topbar ${view === "officer" ? glassStyles.bubble : ""}`}>
        {view === "officer" && <GlassEffect />}
        <Link className="wordmark" href="/" aria-label="Paw Patrol home">
          <Shield />
          <span>Paw Patrol{view === "command" && <small>CONNECTED RESPONSE</small>}</span>
        </Link>
        <WorkspaceNav
          view={view}
          labels={VIEW_NAMES}
          pinnedLabel={workspace ? WORKSPACE_LABELS[workspace] : null}
          onSelect={setView}
        />
        {view !== "hospital" && (
          <button
            className="hardware-toggle"
            data-live={heartRate.status === "receiving"}
            aria-label={view === "officer" ? "Devices" : "Devices offline"}
            onClick={() => setHardware(!hardware)}
            aria-expanded={hardware}
          >
            <Watch size={16} />
            <span>
              {heartRate.status === "receiving" ? "Heart rate live" : "Devices & HeartCast"}
            </span>
          </button>
        )}
      </header>
      <main id="workspace">
        {view === "command" && (
          <>
            <div className="page-heading">
              <div>
                <p className="eyebrow">BOSTON &amp; CAMBRIDGE · OPERATIONS</p>
                <h1>{PHASES[phase].title}</h1>
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
        {hardware && view !== "hospital" && (
          <section
            className={`hardware-panel panel ${view === "officer" ? glassStyles.bubble : ""}`}
          >
            {view === "officer" && <GlassEffect />}
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
            <div
              className={`${officerStyles.unitPicker} ${glassStyles.bubble} ${glassStyles.pill}`}
              data-officer-picker=""
            >
              <GlassEffect />
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
            <div className={glassStyles.sidebar}>
              <OfficerOverview
                person={person}
                onSelect={setSelectedId}
                time={time}
                running={running}
                heartRate={heartRate}
              />
              <div className="map-overlay">
                <LiveTrackPanel state={liveTrack} onFocusDevice={handleFocusDevice} />
                <BuildingPanel building={building} onDismiss={() => setBuilding(null)} />
              </div>
            </div>
            <div className={`${officerStyles.tools} ${glassStyles.bubble} ${glassStyles.pill}`}>
              <GlassEffect />
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
              className={`${officerStyles.camera} ${glassStyles.bubble}`}
              hidden={evidence !== "camera"}
            >
              <GlassEffect />
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
          <HospitalWorkspace
            person={person}
            onSelect={setSelectedId}
            heartRate={heartRate}
            session={session}
            events={bus.events}
            busStatus={bus.status}
            media={officerMedia}
            running={running}
            onPlay={play}
            onPause={() => dispatch({ type: "pause" })}
            onReset={reset}
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

        {view === "command" && (
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
      {view === "command" && (
        <footer>
          <span>PAW PATROL · HACKMIT 2026</span>
          <span>Frontend demo · No external dispatch or clinical decisions</span>
        </footer>
      )}
    </div>
  );
}
