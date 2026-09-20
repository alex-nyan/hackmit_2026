"use client";

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  Activity,
  ArrowUpRight,
  ChevronDown,
  HeartPulse,
  LocateFixed,
  MapPin,
  Pause,
  Play,
  Radio,
  Search,
  Shield,
  Signal,
  SlidersHorizontal,
  Users,
  X,
} from "lucide-react";
import {
  BentoCell,
  BentoLabel,
  BentoNumber,
  BentoRing,
  BentoSparkline,
} from "@/components/ui/builder-os-bento";
import type { MapTheme } from "../boston-map/types";
import type { LiveTrackState } from "../live-track/types";
import { PEOPLE, sampleHeartRate, stamp, type View } from "./scenario";
import { vehicleAt } from "./vehicles/vehicleMotion";
import { describeOrigin, type IncidentEvent } from "./incidents";
import type { BusStatus } from "./useIncidentBus";
import type { Workspace } from "./workspace";
import styles from "./DispatchDashboard.module.css";

interface Props {
  workspace: Workspace | null;
  onViewChange: (view: View) => void;
  selectedId: string;
  onSelect: (id: string) => void;
  onCenter: () => void;
  time: number;
  running: boolean;
  onTogglePlayback: () => void;
  theme: MapTheme;
  map: ReactNode;
  liveTrack: LiveTrackState;
  trackingPanel: ReactNode;
  joinPanel: ReactNode;
  events: IncidentEvent[];
  busStatus: BusStatus;
}

const AREAS = [...new Set(PEOPLE.map((person) => person.area))];

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

/** Presentation of the existing roster and subscriptions; no writes or new data source. */
export function DispatchDashboard({
  workspace,
  onViewChange,
  selectedId,
  onSelect,
  onCenter,
  time,
  running,
  onTogglePlayback,
  theme,
  map,
  liveTrack,
  trackingPanel,
  joinPanel,
  events,
  busStatus,
}: Props) {
  const [query, setQuery] = useState("");
  const [area, setArea] = useState("all");
  const [filter, setFilter] = useState<"all" | "requests">("all");
  const [showAllEvents, setShowAllEvents] = useState(false);
  const person = PEOPLE.find((officer) => officer.id === selectedId) ?? PEOPLE[0];
  const vehicle = vehicleAt(person.id, time);
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
  const onPatrol = PEOPLE.length - knownRequests - acknowledged;
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
  const meanHeartRate = Math.round(
    PEOPLE.reduce((sum, officer) => sum + sampleHeartRate(officer.id, time), 0) / PEOPLE.length,
  );
  const newest = useMemo(() => [...events].sort((a, b) => b.seq - a.seq), [events]);
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
        : "On patrol";
  }

  return (
    <div className={styles.dashboard} data-theme={theme}>
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
        <span className={styles.demoBadge}>
          <span aria-hidden="true" /> Demo workspace
        </span>
      </header>

      <main id="workspace" className={styles.main}>
        <div className={styles.intro}>
          <div>
            <h1>Command centre</h1>
          </div>
          <div className={styles.playback}>
            <span className={styles.clock}>
              <span className={styles.pulseDot} data-running={running} aria-hidden="true" />
              {stamp(time)}
              <small>DEMO CLOCK</small>
            </span>
            <button type="button" className={styles.primary} onClick={onTogglePlayback}>
              {running ? <Pause size={15} /> : <Play size={15} />}
              {running ? "Pause demo" : time > 0 ? "Resume demo" : "Run demo"}
            </button>
          </div>
        </div>

        <div className={styles.metrics} aria-label="Demo fleet statistics">
          <BentoCell className={styles.metric}>
            <BentoLabel icon={Users}>Roster strength</BentoLabel>
            <div className={styles.metricValue}>
              <BentoNumber value={PEOPLE.length} />
              <span>officers</span>
            </div>
            <p>Fictional patrol roster · {AREAS.length} areas</p>
          </BentoCell>
          <BentoCell className={styles.metric}>
            <BentoLabel icon={Shield}>On patrol</BentoLabel>
            <div className={styles.metricValue}>
              <BentoNumber value={onPatrol} />
              <span>of {PEOPLE.length}</span>
            </div>
            <p>
              Demo status
              {busStatus !== "live" ? " · reports not current" : " · excludes assistance requests"}
            </p>
          </BentoCell>
          <BentoCell className={styles.metric}>
            <BentoLabel icon={Radio}>Assistance requests</BentoLabel>
            <div className={styles.metricValue} data-attention={pending.size > 0}>
              {busStatus === "live" ? (
                <BentoNumber value={pending.size} />
              ) : (
                <span className={styles.unknown}>—</span>
              )}
              <span>unacknowledged</span>
            </div>
            <p>
              {busStatus === "live"
                ? "From this deployment’s incident log"
                : "Log unavailable · not an all-clear"}
            </p>
          </BentoCell>
          <BentoCell className={styles.metric}>
            <BentoLabel icon={HeartPulse}>Mean demo heart rate</BentoLabel>
            <div className={styles.metricValue}>
              <BentoNumber value={meanHeartRate} />
              <span>bpm</span>
            </div>
            <p>{PEOPLE.length} synthetic samples · no device data</p>
          </BentoCell>
        </div>

        <div className={styles.grid}>
          <BentoCell className={styles.mapCell} labelledBy="dispatch-map-title">
            <div className={styles.cardHeading}>
              <div>
                <BentoLabel icon={MapPin}>Operational picture</BentoLabel>
                <h2 id="dispatch-map-title">Patrol map</h2>
              </div>
              <span className={styles.smallBadge}>{PEOPLE.length} demo units</span>
            </div>
            <div className={styles.mapFrame}>{map}</div>
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
              <span>OFFICER / AREA</span>
              <span>DEMO BPM</span>
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
                    <span className={styles.avatar}>{officer.initials}</span>
                    <span className={styles.officerIdentity}>
                      <strong>{officer.name}</strong>
                      <small>
                        {officer.id} · {officer.area}
                      </small>
                      <span
                        className={styles.officerStatus}
                        data-attention={requestStates.has(officer.id)}
                      >
                        {officerStatus(officer.id)}
                      </span>
                    </span>
                    <span className={styles.rosterBpm}>
                      {sampleHeartRate(officer.id, time)}
                      <small>bpm</small>
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

          <BentoCell className={styles.selectedCell} labelledBy="dispatch-selected-title">
            <div className={styles.cardHeading}>
              <BentoLabel icon={LocateFixed}>Selected officer / demo</BentoLabel>
              <button type="button" className={styles.textButton} onClick={onCenter}>
                Locate on map <ArrowUpRight size={15} />
              </button>
            </div>
            <div className={styles.selectedGrid}>
              <div className={styles.profile}>
                <span className={styles.profileAvatar}>{person.initials}</span>
                <div>
                  <h2 id="dispatch-selected-title">{person.name}</h2>
                  <p>
                    {person.id} · {person.role}
                  </p>
                  <span
                    className={styles.officerStatus}
                    data-attention={requestStates.has(person.id)}
                  >
                    {officerStatus(person.id)}
                  </span>
                </div>
              </div>
              <dl className={styles.facts}>
                <div>
                  <dt>Patrol area</dt>
                  <dd>{person.area}</dd>
                </div>
                <div>
                  <dt>Simulated speed</dt>
                  <dd>
                    {vehicle.routeId ? `${Math.round(vehicle.speedMps * 3.6)} km/h` : "Unavailable"}
                  </dd>
                </div>
              </dl>
              <div className={styles.selectedVital}>
                <span>
                  <HeartPulse size={14} /> Synthetic heart rate
                </span>
                <strong>
                  {sampleHeartRate(person.id, time)}
                  <small>bpm</small>
                </strong>
                <BentoSparkline
                  values={Array.from({ length: 12 }, (_, i) =>
                    sampleHeartRate(person.id, Math.max(0, time - (11 - i) * 2)),
                  )}
                  label="Synthetic BPM samples, not a measured ECG"
                />
                <small>Demo values · not a measured ECG</small>
              </div>
            </div>
          </BentoCell>

          <BentoCell className={styles.readinessCell} labelledBy="dispatch-status-title">
            <BentoLabel icon={Activity}>Fleet disposition</BentoLabel>
            <h2 id="dispatch-status-title">At a glance</h2>
            <div className={styles.disposition}>
              <BentoRing value={onPatrol} total={PEOPLE.length} label="On patrol" />
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
                  <dt>Acknowledged, not resolved</dt>
                  <dd>{acknowledged}</dd>
                </div>
                <div>
                  <dt>Assignment data</dt>
                  <dd>—</dd>
                </div>
              </dl>
            </div>
            <p className={styles.footnote}>
              Demo roster, not an availability or safety assessment.
              {busStatus !== "live" && " Reports may be out of date."}
            </p>
          </BentoCell>

          <BentoCell className={styles.coverageCell} labelledBy="dispatch-areas-title">
            <BentoLabel icon={MapPin}>Roster distribution</BentoLabel>
            <h2 id="dispatch-areas-title">Patrol areas</h2>
            <p className={styles.cardDescription}>Filter the roster by assigned demo area.</p>
            <div className={styles.areaList}>
              {AREAS.map((name) => {
                const count = PEOPLE.filter((officer) => officer.area === name).length;
                return (
                  <button
                    type="button"
                    key={name}
                    aria-pressed={area === name}
                    onClick={() => setArea((value) => (value === name ? "all" : name))}
                  >
                    <span>{name}</span>
                    <span className={styles.areaBar} aria-hidden="true">
                      <i style={{ width: `${(count / PEOPLE.length) * 100}%` }} />
                    </span>
                    <strong>
                      {count}
                      <small> units</small>
                    </strong>
                  </button>
                );
              })}
            </div>
            <p className={styles.footnote}>
              {AREAS.length} roster areas · not measured geographic coverage
            </p>
          </BentoCell>

          <BentoCell className={styles.activityCell} labelledBy="dispatch-events-title">
            <div className={styles.cardHeading}>
              <div>
                <BentoLabel icon={Radio}>Received reports</BentoLabel>
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
                    : "Log offline"}
              </span>
            </div>
            <p className={styles.cardDescription}>
              This deployment only. Model outputs still require human review.
              {busStatus !== "live" &&
                newest.length > 0 &&
                " Showing last received reports; updates are unavailable."}
            </p>
            {newest.length === 0 ? (
              <div className={styles.emptyState}>
                <Radio size={24} strokeWidth={1.4} />
                <strong>
                  {busStatus === "live" ? "No reports received" : "Waiting for the incident log"}
                </strong>
                <p>
                  {busStatus === "live"
                    ? "Published assistance requests and AI observations will appear here. No report does not mean no incident."
                    : "The log is not current. This is not an all-clear."}
                </p>
              </div>
            ) : (
              <ol className={styles.eventList}>
                {(showAllEvents ? newest : newest.slice(0, 4)).map((event) => (
                  <li key={event.seq}>
                    <details>
                      <summary>
                        <span
                          className={styles.eventDot}
                          data-origin={event.origin}
                          aria-hidden="true"
                        />
                        <span>
                          <strong>{event.title}</strong>
                          <small>
                            {describeOrigin(event)} · {event.personId ?? "Unassigned"}
                          </small>
                        </span>
                        <ChevronDown size={14} aria-hidden="true" />
                      </summary>
                      <div className={styles.eventDetails}>
                        <p>{event.detail}</p>
                        <span>
                          {event.source} · <time dateTime={event.at}>{event.at}</time>
                        </span>
                        {event.provenance && (
                          <span>
                            {event.provenance.provider} / {event.provenance.model} · unconfirmed
                            model output
                          </span>
                        )}
                        {event.requiresHumanReview && <strong>Human review required</strong>}
                      </div>
                    </details>
                  </li>
                ))}
              </ol>
            )}
            {newest.length > 4 && (
              <button
                className={styles.textButton}
                type="button"
                onClick={() => setShowAllEvents((value) => !value)}
              >
                {showAllEvents ? "Show recent reports" : `Show all ${newest.length} reports`}{" "}
                <ChevronDown size={14} />
              </button>
            )}
          </BentoCell>

          <BentoCell className={styles.connectionsCell} labelledBy="dispatch-connections-title">
            <BentoLabel icon={Signal}>Separate live data</BentoLabel>
            <h2 id="dispatch-connections-title">Live connections</h2>
            <div className={styles.connectionCount}>
              <strong>{trackingKnown ? liveCount : "—"}</strong>
              <span>
                fresh GPS fixes<small>{trackingLabel}</small>
              </span>
            </div>
            <p className={styles.cardDescription}>
              Real devices are not included in the 15-person demo roster.
            </p>
            <details className={styles.connectionDetails}>
              <summary>
                Tracking & device setup <ChevronDown size={15} aria-hidden="true" />
              </summary>
              <div>
                {trackingPanel}
                {liveTrack.state === "idle" && (
                  <p>Tracking is paused. Use the map’s tracking control to resume.</p>
                )}
                {joinPanel}
              </div>
            </details>
          </BentoCell>

          <BentoCell className={styles.reservedCell} labelledBy="dispatch-tools-title">
            <BentoLabel icon={SlidersHorizontal}>Workspace extension</BentoLabel>
            <h2 id="dispatch-tools-title">Incident tools</h2>
            <div className={styles.reserved}>
              <span>Not configured</span>
              <p>
                Reserved for your next workflow.
                <br />
                No dispatch actions connected.
              </p>
            </div>
          </BentoCell>
        </div>
        <footer className={styles.footer}>
          <span>
            <Shield size={13} /> Paw Patrol / Dispatch
          </span>
          <span>Demo fleet • Received reports • Live GPS — kept distinct</span>
        </footer>
      </main>
    </div>
  );
}
