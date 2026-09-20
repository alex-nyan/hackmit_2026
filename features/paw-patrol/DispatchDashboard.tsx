"use client";

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  Activity,
  ChevronDown,
  HeartPulse,
  Moon,
  Pause,
  Play,
  Radio,
  Search,
  Shield,
  Signal,
  SlidersHorizontal,
  Smartphone,
  Sun,
  Users,
  Watch,
  X,
} from "lucide-react";
import { BentoCell, BentoLabel } from "@/components/ui/builder-os-bento";
import type { MapTheme } from "../boston-map/types";
import type { LiveTrackState } from "../live-track/types";
import type { HeartRateConnection } from "../heart-rate/useHeartRate";
import { PEOPLE, sampleHeartRate, stamp, type View } from "./scenario";
import { vehicleAt } from "./vehicles/vehicleMotion";
import { describeOrigin, type IncidentEvent } from "./incidents";
import type { BusStatus } from "./useIncidentBus";
import type { Workspace } from "./workspace";
import type { useDemoHotspots } from "./useDemoHotspots";
import { PixelHotspotFlag } from "./PixelHotspotFlag";
import { InferencePreview } from "./InferencePreview";
import { DispatchAmbulanceTools } from "./DispatchAmbulanceTools";
import type { useDemoAmbulances } from "./useDemoAmbulances";
import { MapFullscreenButton } from "./MapFullscreenButton";
import styles from "./DispatchDashboard.module.css";

interface Props {
  alertSource?: string | null;
  workspace: Workspace | null;
  onViewChange: (view: View) => void;
  selectedId: string;
  onSelect: (id: string) => void;
  time: number;
  running: boolean;
  onTogglePlayback: () => void;
  theme: MapTheme;
  onToggleTheme: () => void;
  map: ReactNode;
  situationPanel?: ReactNode;
  liveTrack: LiveTrackState;
  trackingEnabled: boolean;
  onToggleTracking: () => void;
  trackingPanel: ReactNode;
  joinPanel: ReactNode;
  events: IncidentEvent[];
  busStatus: BusStatus;
  ambulanceTools?: ReturnType<typeof useDemoAmbulances>;
  selectedHotspotId?: string | null;
  onSelectHotspot?: (id: string) => void;
  handoffStatus?: "connecting" | "synced" | "offline";
  handoffBridge?: ReactNode;
  hotspotTools?: ReturnType<typeof useDemoHotspots> & {
    placing: boolean;
    dragPoint: { x: number; y: number; dropping: boolean } | null;
    onDrag: (point: { x: number; y: number; dropping: boolean }) => void;
    onBegin: () => void;
    onCancel: () => void;
  };
  localHeartRate: {
    personId: string;
    connection: Pick<HeartRateConnection, "mode" | "status" | "bpm" | "receivedAt">;
  };
}

const AREAS = [...new Set(PEOPLE.map((person) => person.area))];

function currentDeviceBpm(connection: Props["localHeartRate"]["connection"]): number | null {
  return connection.status === "receiving" &&
    connection.receivedAt !== null &&
    connection.bpm !== null &&
    Number.isFinite(connection.bpm) &&
    connection.bpm > 0
    ? connection.bpm
    : null;
}

function PixelHeartReadout({ bpm, source }: { bpm: number | null; source: "demo" | "device" }) {
  const active = bpm !== null && Number.isFinite(bpm) && bpm > 0;
  const sourceLabel = source === "demo" ? "demo" : active ? "device" : "no data";
  const description = active
    ? `${bpm} bpm · ${source === "demo" ? "synthetic demo" : "device reading in this tab"}`
    : "Heart rate unavailable · no current device reading";

  return (
    <span
      className={styles.pixelHeart}
      data-active={active}
      role="img"
      aria-label={description}
      title={description}
    >
      <span className={styles.pixelHeartFace} aria-hidden="true">
        <span className={styles.pixelHeartNumber}>{active ? bpm : "--"}</span>
      </span>
      <span className={styles.pixelHeartSource} aria-hidden="true">
        bpm · {sourceLabel}
      </span>
    </span>
  );
}

function OfficerSignals({
  officerId,
  heartRate,
}: {
  officerId: string;
  heartRate: Props["localHeartRate"];
}) {
  const connection = heartRate.personId === officerId ? heartRate.connection : null;
  let watchState: "unknown" | "receiving" | "waiting" = "unknown";
  let watchLabel = "Watch / heart-rate sensor · no verified connection for this profile";
  if (connection?.mode === "device") {
    if (currentDeviceBpm(connection) !== null) {
      watchState = "receiving";
      watchLabel =
        "Watch / heart-rate sensor · receiving in this tab; manually assigned to this profile, wearer identity not verified.";
    } else if (connection.status === "stale") {
      watchState = "waiting";
      watchLabel = "Watch / heart-rate sensor · signal stale; no usable reading for 30 seconds";
    } else if (connection.status === "waiting") {
      watchState = "waiting";
      watchLabel = "Watch / heart-rate sensor · connected, waiting for a usable signal";
    } else if (connection.status === "requesting" || connection.status === "connecting") {
      watchState = "waiting";
      watchLabel = "Watch / heart-rate sensor · connection pending; no verified signal";
    } else if (connection.status === "disconnected") {
      watchLabel = "Watch / heart-rate sensor · disconnected from this tab";
    } else if (connection.status === "error") {
      watchLabel = "Watch / heart-rate sensor · connection failed; no verified signal";
    }
  }
  const phoneLabel = "Phone · no verified connection for this profile";

  return (
    <span className={styles.deviceSignals}>
      <span role="img" aria-label={watchLabel} title={watchLabel} data-signal={watchState}>
        <Watch size={13} aria-hidden="true" />
      </span>
      <span role="img" aria-label={phoneLabel} title={phoneLabel} data-signal="unknown">
        <Smartphone size={13} aria-hidden="true" />
      </span>
    </span>
  );
}

function OfficerAvatar({ id, initials }: { id: string; initials: string }) {
  const [failed, setFailed] = useState(false);

  return (
    <span className={styles.avatar} aria-hidden="true">
      {failed ? (
        initials
      ) : (
        <Image
          src={`/demo-officers/${id.toLowerCase()}.webp`}
          alt=""
          width={36}
          height={36}
          className={styles.avatarImage}
          unoptimized
          onError={() => setFailed(true)}
        />
      )}
    </span>
  );
}

function WorkspaceSwitcher({ onViewChange }: { onViewChange: (view: View) => void }) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const choicesId = useId();

  useEffect(() => {
    if (!open) return;
    function closeOutside(event: PointerEvent) {
      if (event.target instanceof Node && !container.current?.contains(event.target)) {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open]);

  return (
    <div
      ref={container}
      className={styles.switcher}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.preventDefault();
          setOpen(false);
          trigger.current?.focus();
        }
      }}
    >
      <button
        ref={trigger}
        type="button"
        className={styles.switcherTrigger}
        aria-expanded={open}
        aria-controls={choicesId}
        onClick={() => setOpen((value) => !value)}
      >
        <Radio size={14} aria-hidden="true" />
        Command centre
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open && (
        <div id={choicesId} className={styles.workspaceChoices}>
          <span className={styles.switcherLabel}>Switch workspace</span>
          {(
            [
              ["command", "Command centre", Radio],
              ["officer", "Officer", Shield],
              ["hospital", "Medic", HeartPulse],
            ] as const
          ).map(([view, label, Icon]) => (
            <button
              key={view}
              type="button"
              aria-current={view === "command" ? "page" : undefined}
              onClick={() => {
                setOpen(false);
                onViewChange(view);
              }}
            >
              <Icon size={16} aria-hidden="true" />
              <span>{label}</span>
              {view === "command" && <span className={styles.currentWorkspace}>Current</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Command-only presentation; hotspot dispatches remain local demo state. */
export function DispatchDashboard({
  alertSource,
  workspace,
  onViewChange,
  selectedId,
  onSelect,
  time,
  running,
  onTogglePlayback,
  theme,
  onToggleTheme,
  map,
  situationPanel,
  liveTrack,
  trackingEnabled,
  onToggleTracking,
  trackingPanel,
  joinPanel,
  events,
  busStatus,
  localHeartRate,
  hotspotTools,
  ambulanceTools,
  selectedHotspotId = null,
  onSelectHotspot,
  handoffStatus,
  handoffBridge,
}: Props) {
  const [query, setQuery] = useState("");
  const [area, setArea] = useState("all");
  const [filter, setFilter] = useState<"all" | "requests">("all");
  const [showAllEvents, setShowAllEvents] = useState(false);
  const mapFrame = useRef<HTMLDivElement>(null);
  const flagButton = useRef<HTMLButtonElement>(null);
  const flagGesture = useRef<{ x: number; y: number; pointerId: number; dragging: boolean } | null>(
    null,
  );
  const ignoreFlagClickUntil = useRef(0);
  useEffect(() => {
    if (!hotspotTools?.placing) return;
    const cancel = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        const pointerId = flagGesture.current?.pointerId;
        flagGesture.current = null;
        ignoreFlagClickUntil.current = Date.now() + 500;
        if (pointerId !== undefined && flagButton.current?.hasPointerCapture(pointerId)) {
          flagButton.current.releasePointerCapture(pointerId);
        }
        hotspotTools.onCancel();
        flagButton.current?.focus();
      }
    };
    document.addEventListener("keydown", cancel);
    return () => document.removeEventListener("keydown", cancel);
  }, [hotspotTools]);
  const person = PEOPLE.find((officer) => officer.id === selectedId) ?? PEOPLE[0];
  const selectedDeviceMode =
    localHeartRate.personId === person.id && localHeartRate.connection.mode === "device";
  const selectedBpm = selectedDeviceMode
    ? currentDeviceBpm(localHeartRate.connection)
    : sampleHeartRate(person.id, time);
  const requestStates = useMemo(() => {
    const states = new Map<string, "requested" | "acknowledged">();
    // Acknowledged means seen, never resolved or returned to patrol.
    for (const event of [...events].sort((a, b) => a.seq - b.seq)) {
      if (!event.personId) continue;
      if (event.kind === "panic") states.set(event.personId, "requested");
      if (event.kind === "acknowledge") states.set(event.personId, "acknowledged");
    }
    return states;
  }, [events]);
  const pending = new Set(
    [...requestStates].filter(([, status]) => status === "requested").map(([id]) => id),
  );
  const knownRequests = PEOPLE.filter((officer) => pending.has(officer.id)).length;
  const acknowledged = PEOPLE.filter(
    (officer) => requestStates.get(officer.id) === "acknowledged",
  ).length;
  const responding = PEOPLE.filter(
    (officer) => !requestStates.has(officer.id) && hotspotTools?.unitStatus(officer.id),
  ).length;
  const onPatrol = PEOPLE.length - knownRequests - acknowledged - responding;
  const visible = PEOPLE.filter((officer) => {
    const matchesText = `${officer.name} ${officer.id} ${officer.area}`
      .toLowerCase()
      .includes(query.trim().toLowerCase());
    return (
      matchesText &&
      (area === "all" || officer.area === area) &&
      (filter === "all" || pending.has(officer.id))
    );
  });
  const newest = useMemo(() => [...events].sort((a, b) => b.seq - a.seq), [events]);
  const timeline = [
    ...newest.map((event) => ({
      id: `report-${event.seq}`,
      at: event.at,
      title: event.title,
      detail: event.detail,
      origin: event.origin,
      label: `${describeOrigin(event)} · ${event.personId ?? "Unassigned"}`,
      source: event.source,
      provenance: event.provenance,
      requiresHumanReview: event.requiresHumanReview,
    })),
    ...[...(hotspotTools?.logs ?? [])].reverse().map((event) => ({
      ...event,
      origin: "demo-hotspot",
      label: `Local demo · ${event.hotspotId}`,
      source: "Command Centre simulation · this tab only",
      provenance: undefined,
      requiresHumanReview: false,
    })),
  ].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const liveCount =
    liveTrack.state === "tracking"
      ? liveTrack.devices.filter((device) => device.fix?.freshness === "live").length
      : 0;
  const trackingKnown = liveTrack.state === "tracking" || liveTrack.state === "no-devices";
  const trackingLabel = {
    idle: "Tracking paused",
    connecting: "Connecting",
    "not-configured": "Not configured",
    unavailable: "Unavailable",
    "no-devices": "No units connected",
    tracking: "GPS reporting",
  }[liveTrack.state];

  function clearFilters() {
    setQuery("");
    setArea("all");
    setFilter("all");
  }

  function officerStatus(id: string) {
    const state = requestStates.get(id);
    return state === "requested"
      ? "Assistance requested"
      : state === "acknowledged"
        ? "Request acknowledged · not resolved"
        : (hotspotTools?.unitStatus(id) ?? "On patrol");
  }

  return (
    <div className={styles.dashboard} data-theme={theme}>
      {handoffBridge}
      <a className="skip-link" href="#workspace">
        Skip to workspace
      </a>
      <header className={styles.header}>
        <Link href="/" aria-label="Paw Patrol home" className={styles.brand}>
          <span className={styles.brandIcon}>
            <Shield size={19} aria-hidden="true" />
          </span>
          <strong>Paw Patrol</strong>
          <span className={styles.divider}>/</span>
          <span>Command desk</span>
        </Link>
        <nav aria-label="Workspace" className={styles.navigation}>
          {workspace ? (
            <span aria-current="page">
              <Radio size={14} aria-hidden="true" /> Command centre
            </span>
          ) : (
            <WorkspaceSwitcher onViewChange={onViewChange} />
          )}
        </nav>
        <Link href="/sign-in" className={styles.accountLink}>
          Officer sign-in
        </Link>
        <span className={styles.demoBadge}>
          <span aria-hidden="true" /> Demo workspace
        </span>
      </header>

      <main id="workspace" className={styles.main}>
        <div className={styles.intro}>
          <div>
            <p className={styles.sectionLabel}>Operations / Boston &amp; Cambridge</p>
            <h1>Command centre</h1>
            <p className={styles.introNote}>
              Patrol coverage, field reports and coordinated response.
            </p>
          </div>
          <div className={styles.playback}>
            <div className={styles.clockControls}>
              <button
                type="button"
                className={styles.themeControl}
                onClick={onToggleTheme}
                aria-label="Toggle map theme"
                title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
              >
                {theme === "dark" ? (
                  <Sun size={19} aria-hidden="true" />
                ) : (
                  <Moon size={19} aria-hidden="true" />
                )}
              </button>
              <span className={styles.clock}>
                <span className={styles.pulseDot} data-running={running} aria-hidden="true" />
                {stamp(time)}
                <small>DEMO CLOCK</small>
              </span>
            </div>
            <button type="button" className={styles.primary} onClick={onTogglePlayback}>
              {running ? <Pause size={15} /> : <Play size={15} />}
              {running ? "Pause demo" : time > 0 ? "Resume demo" : "Run demo"}
            </button>
          </div>
        </div>

        <div className={styles.grid} data-placing={hotspotTools?.placing || undefined}>
          <BentoCell className={styles.mapCell} labelledBy="dispatch-map-title">
            <div className={styles.cardHeading}>
              <h2 id="dispatch-map-title">Patrol map</h2>
              <span className={styles.smallBadge}>{PEOPLE.length} demo units</span>
              <MapFullscreenButton />
            </div>
            <div className={styles.mapFrame} ref={mapFrame}>
              {map}
            </div>
            <div className={styles.mapFooter}>
              <span>
                <i aria-hidden="true" /> Demo patrol vehicles
              </span>
              <span>Fixed-size markers · select to inspect</span>
            </div>
          </BentoCell>

          <BentoCell className={styles.rosterCell} labelledBy="dispatch-roster-title">
            <div className={styles.cardHeading}>
              <div>
                <BentoLabel icon={Users}>Personnel</BentoLabel>
                <h2 id="dispatch-roster-title">Officer roster</h2>
              </div>
              <span className={styles.smallBadge}>
                {visible.length} / {PEOPLE.length}
              </span>
            </div>
            <label className={styles.search}>
              <Search size={15} aria-hidden="true" />
              <span className="sr-only">Search officers</span>
              <input
                type="search"
                placeholder="Name, ID or patrol area"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <div className={styles.rosterFilters}>
              <label>
                <SlidersHorizontal size={13} aria-hidden="true" />
                <span className="sr-only">Filter patrol area</span>
                <select value={area} onChange={(event) => setArea(event.target.value)}>
                  <option value="all">All patrol areas</option>
                  {AREAS.map((name) => (
                    <option key={name}>{name}</option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                aria-pressed={filter === "requests"}
                onClick={() => setFilter((value) => (value === "all" ? "requests" : "all"))}
              >
                Requests <span>{knownRequests}</span>
              </button>
            </div>
            <div className={styles.rosterColumns} aria-hidden="true">
              <span>OFFICER</span>
              <span>SPEED</span>
              <span>PATROL AREA</span>
              <span>BPM / SOURCE</span>
            </div>
            <ul className={styles.roster} aria-label="Dispatch officer roster">
              {visible.map((officer) => (
                <li key={officer.id}>
                  <button
                    type="button"
                    className={styles.officerRow}
                    aria-pressed={officer.id === selectedId}
                    onClick={() => onSelect(officer.id)}
                  >
                    <OfficerAvatar key={officer.id} id={officer.id} initials={officer.initials} />
                    <span className={styles.officerIdentity}>
                      <strong>{officer.name}</strong>
                      <small>{officer.id}</small>
                      <span className={styles.officerStatusLine}>
                        <span
                          className={styles.officerStatus}
                          data-attention={
                            requestStates.has(officer.id) || !!hotspotTools?.unitStatus(officer.id)
                          }
                        >
                          {officerStatus(officer.id)}
                        </span>
                        <OfficerSignals officerId={officer.id} heartRate={localHeartRate} />
                      </span>
                    </span>
                    <span className={styles.officerSpeed} title="Simulated patrol speed · demo">
                      <span className="sr-only">Demo speed: </span>
                      <strong>
                        {Math.round(
                          (
                            hotspotTools?.sampleVehicle(officer.id, time) ??
                            vehicleAt(officer.id, time)
                          ).speedMps * 3.6,
                        )}
                      </strong>
                      <small>km/h</small>
                    </span>
                    <span className={styles.officerArea} title="Assigned patrol area · demo">
                      <span className="sr-only">Demo patrol area: </span>
                      {officer.area}
                    </span>
                    <span className={styles.rosterBpm}>
                      <PixelHeartReadout
                        bpm={
                          officer.id === person.id ? selectedBpm : sampleHeartRate(officer.id, time)
                        }
                        source={officer.id === person.id && selectedDeviceMode ? "device" : "demo"}
                      />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {visible.length === 0 && (
              <div className={styles.emptySearch}>
                <Search size={22} />
                <strong>No matching officers</strong>
                <p>Try another name or clear your filters.</p>
                <button type="button" onClick={clearFilters}>
                  Clear filters <X size={13} />
                </button>
              </div>
            )}
            <p className={styles.footnote}>Roster filters do not hide units on the map.</p>
          </BentoCell>

          <BentoCell className={styles.readinessCell} labelledBy="dispatch-status-title">
            <BentoLabel icon={Activity}>Fleet disposition</BentoLabel>
            <h2 id="dispatch-status-title">Patrol status</h2>
            <div className={styles.disposition}>
              <div className={styles.fleetTotal}>
                <strong>{onPatrol}</strong>
                <span>of {PEOPLE.length} on patrol</span>
              </div>
              <dl>
                <div>
                  <dt>
                    <i aria-hidden="true" />
                    On patrol
                  </dt>
                  <dd>{onPatrol}</dd>
                </div>
                <div>
                  <dt>
                    <i data-warning aria-hidden="true" />
                    Requesting assistance
                  </dt>
                  <dd>{knownRequests}</dd>
                </div>
                <div>
                  <dt>Awaiting resolution</dt>
                  <dd>{acknowledged}</dd>
                </div>
                <div>
                  <dt>Hotspot responders · demo</dt>
                  <dd>{responding}</dd>
                </div>
              </dl>
            </div>
            <p className={styles.footnote}>
              Simulated roster.
              {busStatus !== "live" && " Reports may be out of date."}
            </p>
          </BentoCell>

          <BentoCell className={styles.coverageCell} labelledBy="dispatch-inference-title">
            <InferencePreview events={events} status={busStatus} selectedSource={alertSource} />
            {situationPanel}
            {selectedHotspotId && (
              <p className={styles.inferenceContext}>
                Selected incident: {selectedHotspotId} · sample context only
              </p>
            )}
          </BentoCell>

          <BentoCell className={styles.connectionsCell} labelledBy="dispatch-tools-title">
            <BentoLabel icon={SlidersHorizontal}>Workspace controls</BentoLabel>
            <h2 id="dispatch-tools-title">Response tools</h2>
            {hotspotTools && (
              <>
                <div className={styles.toolActions}>
                  <button
                    ref={flagButton}
                    type="button"
                    className={styles.hotspotTool}
                    aria-pressed={hotspotTools.placing}
                    aria-label="Place demo hotspot"
                    onClick={() => {
                      if (Date.now() < ignoreFlagClickUntil.current) return;
                      if (hotspotTools.placing) hotspotTools.onCancel();
                      else {
                        hotspotTools.onBegin();
                        requestAnimationFrame(() => {
                          if (window.innerWidth <= 900) {
                            mapFrame.current?.scrollIntoView({
                              block: "center",
                              behavior: "instant",
                            });
                          }
                          mapFrame.current
                            ?.querySelector<HTMLButtonElement>("[data-hotspot-centre]")
                            ?.focus({ preventScroll: true });
                        });
                      }
                    }}
                    onPointerDown={(event) => {
                      if (event.button !== 0 || !event.isPrimary || flagGesture.current) return;
                      flagGesture.current = {
                        x: event.clientX,
                        y: event.clientY,
                        pointerId: event.pointerId,
                        dragging: false,
                      };
                      event.currentTarget.setPointerCapture(event.pointerId);
                    }}
                    onPointerMove={(event) => {
                      const gesture = flagGesture.current;
                      if (!gesture || event.pointerId !== gesture.pointerId) return;
                      if (
                        !gesture.dragging &&
                        Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) < 6
                      )
                        return;
                      if (!gesture.dragging) {
                        gesture.dragging = true;
                        hotspotTools.onBegin();
                      }
                      event.preventDefault();
                      hotspotTools.onDrag({ x: event.clientX, y: event.clientY, dropping: false });
                    }}
                    onPointerUp={(event) => {
                      const gesture = flagGesture.current;
                      if (gesture && event.pointerId !== gesture.pointerId) return;
                      flagGesture.current = null;
                      if (gesture?.dragging) {
                        ignoreFlagClickUntil.current = Date.now() + 500;
                        hotspotTools.onDrag({ x: event.clientX, y: event.clientY, dropping: true });
                      }
                    }}
                    onPointerCancel={(event) => {
                      if (flagGesture.current && event.pointerId !== flagGesture.current.pointerId)
                        return;
                      flagGesture.current = null;
                      hotspotTools.onCancel();
                    }}
                    onLostPointerCapture={(event) => {
                      if (flagGesture.current && event.pointerId !== flagGesture.current.pointerId)
                        return;
                      if (flagGesture.current?.dragging) hotspotTools.onCancel();
                      flagGesture.current = null;
                    }}
                  >
                    <PixelHotspotFlag />
                    <span>
                      <strong>
                        {hotspotTools.placing ? "Choose a map location" : "Hotspot flag"}
                      </strong>
                      <small>Drag onto map or click to place</small>
                      <small>Nearby demo units respond · no real alerts</small>
                    </span>
                    <span className={styles.hotspotCount}>
                      {
                        hotspotTools.hotspots.filter((hotspot) => hotspot.resolvedAt === null)
                          .length
                      }
                      <small>active</small>
                    </span>
                  </button>
                  {ambulanceTools && onSelectHotspot && (
                    <DispatchAmbulanceTools
                      hotspots={hotspotTools.hotspots}
                      selectedId={selectedHotspotId}
                      onSelect={onSelectHotspot}
                      ambulance={ambulanceTools}
                      time={time}
                    />
                  )}
                </div>
                <p className={styles.hotspotMessage} role="status" aria-live="polite">
                  {hotspotTools.placing
                    ? "Hold near a map edge to pan. Release to place; Escape cancels."
                    : hotspotTools.message ||
                      "Click a placed flag to resolve it. Demo history resets on reload."}
                </p>
                {ambulanceTools && (
                  <p className={styles.handoffState} role="status">
                    Browser relay ·{" "}
                    {handoffStatus === "synced"
                      ? "ready for Medic handoff"
                      : handoffStatus === "offline"
                        ? "handoff offline — keep medics holding"
                        : "waiting for demo handoff"}
                  </p>
                )}
              </>
            )}
            <details className={styles.connectionDetails}>
              <summary>
                Tracking & device setup <ChevronDown size={15} aria-hidden="true" />
              </summary>
              <div>
                <div className={styles.connectionCount}>
                  <strong>{trackingKnown ? liveCount : "—"}</strong>
                  <span>
                    fresh GPS fixes<small>{trackingLabel}</small>
                  </span>
                </div>
                <p className={styles.cardDescription}>
                  Connected devices appear separately from the demo roster.
                </p>
                <button
                  type="button"
                  className={styles.textButton}
                  aria-pressed={trackingEnabled}
                  onClick={onToggleTracking}
                >
                  <Signal size={13} aria-hidden="true" />
                  {trackingEnabled ? "Pause GPS tracking" : "Resume GPS tracking"}
                </button>
                {trackingPanel}
                {liveTrack.state === "idle" && (
                  <p>Tracking is paused. Resume to receive positions again.</p>
                )}
                {joinPanel}
              </div>
            </details>
          </BentoCell>
        </div>

        {hotspotTools?.placing && hotspotTools.dragPoint && !hotspotTools.dragPoint.dropping && (
          <div
            className={styles.draggingFlag}
            aria-hidden="true"
            style={{ left: hotspotTools.dragPoint.x, top: hotspotTools.dragPoint.y }}
          >
            <PixelHotspotFlag />
            <span>Drop hotspot</span>
          </div>
        )}

        <BentoCell className={styles.activityCell} labelledBy="dispatch-events-title">
          <div className={styles.cardHeading}>
            <div>
              <BentoLabel icon={Radio}>Incident log</BentoLabel>
              <h2 id="dispatch-events-title">Activity feed</h2>
            </div>
            <span
              className={styles.connectionState}
              data-connected={busStatus === "live"}
              role="status"
            >
              {busStatus === "live"
                ? "Log connected"
                : busStatus === "connecting"
                  ? "Connecting"
                  : "Received reports offline"}
            </span>
          </div>
          <p className={styles.cardDescription}>
            Demo activity resets on reload. Review automated reports before acting.
            {busStatus !== "live" &&
              newest.length > 0 &&
              " Showing last received reports; updates are unavailable."}
          </p>
          {timeline.length === 0 ? (
            <div className={styles.emptyState}>
              <Radio size={24} strokeWidth={1.4} />
              <strong>
                {busStatus === "live" ? "No reports received" : "Waiting for the incident log"}
              </strong>
              <p>
                {busStatus === "live"
                  ? "Assistance requests and camera reports will appear here."
                  : "Updates are offline. Reconnect to receive reports."}
              </p>
            </div>
          ) : (
            <ol className={styles.eventList}>
              {(showAllEvents ? timeline : timeline.slice(0, 8)).map((event) => (
                <li key={event.id}>
                  <details>
                    <summary>
                      <span
                        className={styles.eventDot}
                        data-origin={event.origin}
                        aria-hidden="true"
                      />
                      <span>
                        <strong>{event.title}</strong>
                        <small>{event.label}</small>
                      </span>
                      <time className={styles.eventTime} dateTime={event.at}>
                        {event.at.slice(11, 19)} UTC
                      </time>
                      <ChevronDown size={14} aria-hidden="true" />
                    </summary>
                    <div className={styles.eventDetails}>
                      <p>{event.detail}</p>
                      <span>
                        {event.source} · <time dateTime={event.at}>{event.at}</time>
                      </span>
                      {event.provenance && (
                        <span>
                          {event.provenance.provider} / {event.provenance.model} · unconfirmed model
                          output
                        </span>
                      )}
                      {event.requiresHumanReview && <strong>Human review required</strong>}
                    </div>
                  </details>
                </li>
              ))}
            </ol>
          )}
          {timeline.length > 8 && (
            <button
              className={styles.textButton}
              type="button"
              onClick={() => setShowAllEvents((value) => !value)}
            >
              {showAllEvents ? "Show recent entries" : `Show all ${timeline.length} entries`}{" "}
              <ChevronDown size={14} />
            </button>
          )}
        </BentoCell>
      </main>
    </div>
  );
}
