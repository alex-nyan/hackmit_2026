"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { BrandLogo } from "@/components/BrandLogo";
import {
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
import type { Officer } from "@/features/access/roster";
import { liveOfficer } from "./liveOfficer";
import { AudioAlerts, useAudioAlerts } from "./AudioAlerts";
import { AudioIntelligencePanel } from "../audio-ai/AudioIntelligencePanel";
import type { IncidentEvent } from "./incidents";
import { CapturePanel } from "@/features/camera-triage";
import { LiveTrackPanel, UnitCard, useLiveTrack, type LiveDevice } from "@/features/live-track";
import { OperationsMap } from "./OperationsMap";
import { DispatchDashboard } from "./DispatchDashboard";
import { useDemoHotspots } from "./useDemoHotspots";
import { useDemoAmbulances } from "./useDemoAmbulances";
import { useDemoHandoff } from "./useDemoHandoff";
import { OfficerOverview } from "./OfficerOverview";
import { OfficerDashboard } from "./OfficerDashboard";
import { OfficerIncidentBriefing } from "./OfficerIncidentBriefing";
import { GlassEffect } from "@/components/ui/liquid-glass";
import glassStyles from "./OfficerGlass.module.css";
import { WorkspaceNav } from "./WorkspaceNav";
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
import { SituationPanel } from "./SituationPanel";
import type { IncidentDraft } from "./incidents";
import { BusIndicator, SharedTimeline } from "./Provenance";
import { HeartRatePanel } from "../heart-rate/HeartRatePanel";
import {
  useHeartRate,
  type HeartRateConnection,
  type HeartRateSample,
} from "../heart-rate/useHeartRate";

/** Stable identity so a poll that finds nothing does not rerun the map effect. */
const EMPTY_DEVICES: LiveDevice[] = [];

const VIEW_NAMES: Record<View, string> = {
  command: "Command centre",
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
  officer,
  presentation = "map",
}: {
  workspace?: Workspace | null;
  officerMedia?: OfficerMediaInput | null;
  officer?: Officer | null;
  /** Dispatch defaults to the map-first dashboard; retain its detailed workflows. */
  presentation?: "map" | "detailed";
}) {
  const { time, running, readClock, dispatch, sceneOverride, panics, audit } = useScenario();
  // The only state shared across workspaces. Everything else stays local.
  const bus = useIncidentBus();
  const audioAlerts = useAudioAlerts(bus.events);
  const [alertSource, setAlertSource] = useState<string | null>(null);
  const [session, setSession] = useState(0);
  const [tactical, setTactical] = useState(emptyTactical);
  const fixedView = workspace ? WORKSPACE_VIEWS[workspace] : undefined;
  const [selectedView, setSelectedView] = useState<View>("command");
  const view = fixedView ?? selectedView;
  function setView(nextView: View) {
    if (!fixedView) setSelectedView(nextView);
  }
  const [selectedId, setSelectedId] = useState<string>(
    officer?.id.match(/^unit-(\d{2})$/) ? officer.id.replace("unit-", "P-") : "P-01",
  );
  const [focus, setFocus] = useState<MapFocus>("all");
  const [theme, setTheme] = useState<MapTheme>("light");
  // Command owns its presentation theme; switching to Officer/Hospital keeps theirs intact.
  const [dispatchTheme, setDispatchTheme] = useState<MapTheme>("dark");
  const dispatchDashboard = view === "command" && presentation === "map";
  const mapTheme = dispatchDashboard ? dispatchTheme : theme;
  const [recenterKey, setRecenterKey] = useState(0);
  const [dispatchAreaFocusKey, setDispatchAreaFocusKey] = useState(0);
  const [following, setFollowing] = useState(false);
  const [placingHotspot, setPlacingHotspot] = useState(false);
  const [hotspotDrag, setHotspotDrag] = useState<{
    x: number;
    y: number;
    dropping: boolean;
  } | null>(null);
  const cancelHotspotPlacement = () => {
    setPlacingHotspot(false);
    setHotspotDrag(null);
  };
  const unavailableHotspotUnits = useMemo(
    () => [
      ...new Set(
        bus.events
          .filter((event) => event.kind === "panic" || event.kind === "acknowledge")
          .flatMap((event) => (event.personId ? [event.personId] : [])),
      ),
    ],
    [bus.events],
  );
  const hotspots = useDemoHotspots({
    time,
    readClock,
    enabled: dispatchDashboard,
    unavailableIds: unavailableHotspotUnits,
  });
  const [selectedHotspotId, setSelectedHotspotId] = useState<string | null>(null);
  const handoffPublisher = workspace === null || workspace === "dispatch";
  const ambulances = useDemoAmbulances({
    hotspots: hotspots.hotspots,
    time,
    readClock,
    enabled: handoffPublisher,
  });
  const handoff = useDemoHandoff({ publisher: handoffPublisher, missions: ambulances.missions });
  const [hardware, setHardware] = useState(false);
  const [evidence, setEvidence] = useState<"camera" | "audio" | null>(null);
  // The camera and microphone stay opt-in. Tracking does not: it was opt-in
  // when it meant reaching out to a Traccar server holding credentials
  // somewhere else, and the positions now come from this deployment's own
  // store, where phones paired from Officer publish their positions.
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
  const selectAudioAlert = useCallback((event: IncidentEvent) => {
    setAlertSource(event.source);
    setOpenDeviceId(event.source);
    if (event.location) {
      const { longitude, latitude } = event.location;
      setFollowing(false);
      setFixRequest((previous) => ({ longitude, latitude, nonce: (previous?.nonce ?? 0) + 1 }));
    }
  }, []);
  const person = PEOPLE.find((p) => p.id === selectedId) ?? PEOPLE[0];
  // Device readings stay local until an operator shares a snapshot.
  const heartRate = useHeartRate(person.id, session);
  const [phonePreview, setPhonePreview] = useState({ sourceId: "", connected: false });
  const onPhoneConnectionChange = useCallback((sourceId: string, connected: boolean) => {
    setPhonePreview((current) =>
      current.sourceId === sourceId && current.connected === connected
        ? current
        : { sourceId, connected },
    );
  }, []);
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
  function selectCommandOfficer(id: string) {
    setSelectedId(id);
    const live = liveOfficer(id, liveDevices);
    if (live) {
      handleFocusDevice(live);
      return;
    }
    setFollowing(true);
    setRecenterKey((key) => key + 1);
  }
  const map = (
    <section className="map-panel" aria-label="Operations map">
      {!dispatchDashboard && (
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
              onClick={() => setTheme((current) => (current === "light" ? "dark" : "light"))}
            >
              {theme === "light" ? <Moon size={17} /> : <Sun size={17} />}
            </button>
          </div>
        </div>
      )}
      <div className="map-wrapper">
        <OperationsMap
          appearance={view === "officer" ? "glass" : "default"}
          time={time}
          running={running}
          readClock={readClock}
          selectedId={selectedId}
          onSelect={selectCommandOfficer}
          focus={focus}
          areaFocusKey={dispatchDashboard ? dispatchAreaFocusKey : 0}
          theme={mapTheme}
          recenterKey={recenterKey}
          following={following}
          onStopFollowing={() => setFollowing(false)}
          audioAlerts={audioAlerts}
          onSelectAudioAlert={selectAudioAlert}
          liveDevices={liveDevices}
          fixRequest={fixRequest}
          onSelectLiveDevice={setOpenDeviceId}
          onBuildingSelect={handleBuildingSelect}
          hotspot={
            dispatchDashboard
              ? {
                  placing: placingHotspot,
                  dragPoint: hotspotDrag,
                  hotspots: hotspots.hotspots,
                  onPlace: (point) => {
                    hotspots.place(point);
                    cancelHotspotPlacement();
                    dispatch({ type: "play" });
                  },
                  onCancel: cancelHotspotPlacement,
                  onResolve: hotspots.resolve,
                  onSelect: setSelectedHotspotId,
                  sampleVehicle: hotspots.sampleVehicle,
                }
              : undefined
          }
          ambulance={
            dispatchDashboard
              ? {
                  missions: ambulances.missions,
                  sample: ambulances.sampleAmbulance,
                  onSelect: setSelectedHotspotId,
                }
              : undefined
          }
        />
        <AudioAlerts alerts={audioAlerts} status={bus.status} onSelect={selectAudioAlert} />
        <div className="map-overlay">
          {!dispatchDashboard && view !== "officer" && !openDevice && (
            <LiveTrackPanel state={liveTrack} onFocusDevice={handleFocusDevice} />
          )}
          {openDevice && (
            <UnitCard
              key={openDevice.id}
              device={openDevice}
              heartRate={heartRate}
              onDismiss={() => setOpenDeviceId(null)}
            />
          )}
          <BuildingPanel building={building} onDismiss={() => setBuilding(null)} />
        </div>
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
                if (dispatchDashboard) setDispatchAreaFocusKey((value) => value + 1);
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
  // Capture observations are published centrally by the API routes.
  if (dispatchDashboard) {
    return (
      <DispatchDashboard
        alertSource={alertSource}
        workspace={workspace}
        onViewChange={setView}
        selectedId={selectedId}
        onSelect={selectCommandOfficer}
        time={time}
        running={running}
        onTogglePlayback={() => (running ? dispatch({ type: "pause" }) : play())}
        theme={dispatchTheme}
        onToggleTheme={() =>
          setDispatchTheme((current) => (current === "light" ? "dark" : "light"))
        }
        map={map}
        situationPanel={
          <>
            <AudioIntelligencePanel events={bus.events} status={bus.status} publish={publish} />
            <SituationPanel
              inline
              events={bus.events}
              status={bus.status}
              publish={publish}
              personId={person.id}
              heartRate={heartRate}
            />
          </>
        }
        liveTrack={liveTrack}
        trackingEnabled={tracking}
        onToggleTracking={() => setTracking((value) => !value)}
        trackingPanel={<LiveTrackPanel state={liveTrack} onFocusDevice={handleFocusDevice} />}
        joinPanel={null}
        events={bus.events}
        busStatus={bus.status}
        localHeartRate={{ personId: person.id, connection: heartRate }}
        hotspotTools={{
          ...hotspots,
          logs: [...hotspots.logs, ...ambulances.logs],
          placing: placingHotspot,
          dragPoint: hotspotDrag,
          onDrag: setHotspotDrag,
          onBegin: () => {
            setFollowing(false);
            setBuilding(null);
            setOpenDeviceId(null);
            setPlacingHotspot(true);
          },
          onCancel: cancelHotspotPlacement,
        }}
        ambulanceTools={{
          ...ambulances,
          dispatchAmbulance: (id) => {
            const accepted = ambulances.dispatchAmbulance(id);
            if (accepted) dispatch({ type: "play" });
            return accepted;
          },
        }}
        selectedHotspotId={selectedHotspotId}
        onSelectHotspot={setSelectedHotspotId}
        handoffStatus={handoff.status}
        handoffBridge={handoff.bridge}
      />
    );
  }

  if (view === "officer") {
    return (
      <>
        {handoff.bridge}
        <OfficerDashboard
          officer={officer}
          workspace={workspace}
          onViewChange={setView}
          person={person}
          onSelect={selectCommandOfficer}
          time={time}
          running={running}
          onTogglePlayback={() => (running ? dispatch({ type: "pause" }) : play())}
          onReset={reset}
          theme={theme}
          onToggleTheme={() => setTheme((current) => (current === "light" ? "dark" : "light"))}
          map={map}
          heartRate={heartRate}
          phoneConnected={
            phonePreview.sourceId === (officer?.id ?? `officer-${person.id}`) &&
            phonePreview.connected
          }
          heartRatePanel={
            <>
              <HeartRatePanel
                connection={heartRate}
                personId={person.id}
                personName={person.name}
                compact
              />
              <details>
                <summary>Heart rate trend</summary>
                <HeartChart
                  time={time}
                  id={person.id}
                  deviceSamples={heartRate.mode === "device" ? heartRate.history : undefined}
                />
              </details>
            </>
          }
          capturePanel={
            <CapturePanel
              key={officer?.id ?? person.id}
              sourceId={officer?.id ?? `officer-${person.id}`}
              displayName={officer?.name ?? person.name}
              onPhoneConnectionChange={onPhoneConnectionChange}
            />
          }
          incidentPanel={(demo) => (
            <OfficerIncidentBriefing
              events={bus.events}
              busStatus={bus.status}
              personId={officer?.id ?? person.id}
              demo={demo}
              onLocate={(id) => {
                const unit = vehicleAt(id, readClock().time);
                if (!unit.routeId) return;
                setFollowing(false);
                setFixRequest((previous) => ({
                  longitude: unit.point[0],
                  latitude: unit.point[1],
                  nonce: (previous?.nonce ?? 0) + 1,
                }));
              }}
            />
          )}
          overview={
            <OfficerOverview
              person={person}
              onSelect={setSelectedId}
              time={time}
              running={running}
              heartRate={heartRate}
            />
          }
          trackingPanel={
            <>
              <LiveTrackPanel state={liveTrack} onFocusDevice={handleFocusDevice} />
              <BuildingPanel building={building} onDismiss={() => setBuilding(null)} />
            </>
          }
        />
      </>
    );
  }

  return (
    <div
      className={`paw-app ${view === "hospital" ? hospitalStyles.hospital : ""}`}
      data-hospital-theme={view === "hospital" ? theme : undefined}
    >
      <a className="skip-link" href="#workspace">
        Skip to workspace
      </a>
      <header className="topbar">
        <Link className="wordmark" href="/" aria-label="Paw Patrol home">
          <BrandLogo />
          <span>Paw Patrol{view === "command" && <small>CONNECTED RESPONSE</small>}</span>
        </Link>
        <WorkspaceNav
          view={view}
          labels={VIEW_NAMES}
          pinnedLabel={workspace ? WORKSPACE_LABELS[workspace] : null}
          onSelect={setView}
        />
        {officer ? (
          <form action="/api/sign-in" method="post">
            <span>
              {officer.name} · {officer.badge}{" "}
            </span>
            <button name="action" value="sign-out" className="hardware-toggle">
              Sign out
            </button>
          </form>
        ) : (
          <Link href="/sign-in" className="hardware-toggle">
            Officer sign-in
          </Link>
        )}
        {view !== "hospital" && (
          <button
            className="hardware-toggle"
            data-live={heartRate.status === "receiving"}
            aria-label="Devices offline"
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
        {view === "hospital" && handoff.bridge}
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

        {view === "hospital" && (
          <HospitalWorkspace
            time={time}
            theme={theme}
            onToggleTheme={() => setTheme((current) => (current === "light" ? "dark" : "light"))}
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
            handoff={{
              missions: handoff.missions,
              status: handoff.status,
              updatedAt: handoff.updatedAt,
            }}
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
        <SituationPanel
          hideEmptyObservation={view === "hospital"}
          events={bus.events}
          status={bus.status}
          publish={publish}
          personId={officer?.id ?? person.id}
          heartRate={heartRate}
        />
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
