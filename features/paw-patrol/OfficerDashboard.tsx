"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type CSSProperties,
  type ReactNode,
} from "react";
import Image from "next/image";
import Link from "next/link";
import {
  Camera,
  ChevronDown,
  HeartPulse,
  Moon,
  Pause,
  Play,
  RotateCcw,
  Shield,
  Signal,
  Smartphone,
  Sun,
  Watch,
} from "lucide-react";
import type { Officer } from "@/features/access/roster";
import type { MapTheme } from "../boston-map/types";
import type { HeartRateConnection } from "../heart-rate/useHeartRate";
import { PEOPLE, personStatus, sampleHeartRate, stamp, type Person, type View } from "./scenario";
import { vehicleAt } from "./vehicles/vehicleMotion";
import type { Workspace } from "./workspace";
import { MapFullscreenButton } from "./MapFullscreenButton";
import styles from "./OfficerDashboard.module.css";

export interface OfficerDashboardProps {
  officer?: Officer | null;
  workspace: Workspace | null;
  onViewChange: (view: View) => void;
  person: Person;
  onSelect: (id: string) => void;
  time: number;
  running: boolean;
  onTogglePlayback: () => void;
  onReset: () => void;
  theme: MapTheme;
  onToggleTheme: () => void;
  map: ReactNode;
  heartRate: HeartRateConnection;
  heartRatePanel: ReactNode;
  capturePanel: ReactNode;
  overview: ReactNode;
  trackingPanel: ReactNode;
  phoneConnected: boolean;
  incidentPanel: (demo: boolean) => ReactNode;
}

function WorkspaceSwitcher({ onViewChange }: Pick<OfficerDashboardProps, "onViewChange">) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  return (
    <div className={styles.switcher} ref={root}>
      <button
        className={styles.glassControl}
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((value) => !value)}
      >
        <Shield size={14} aria-hidden="true" /> Officer <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open && (
        <nav id={id} className={styles.workspaceChoices} aria-label="Switch workspace">
          {(
            [
              ["command", "Command centre"],
              ["officer", "Officer"],
              ["hospital", "Medic"],
            ] as const
          ).map(([view, label]) => (
            <button
              type="button"
              key={view}
              aria-current={view === "officer" ? "page" : undefined}
              onClick={() => {
                setOpen(false);
                onViewChange(view);
              }}
            >
              {label}
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}

function OfficerAvatar({ person }: { person: Person }) {
  const [failedId, setFailedId] = useState<string | null>(null);
  return (
    <span className={styles.avatar} aria-hidden="true">
      {failedId === person.id ? (
        person.initials
      ) : (
        <Image
          src={`/demo-officers/${person.id.toLowerCase()}.webp`}
          width={56}
          height={56}
          alt=""
          onError={() => setFailedId(person.id)}
        />
      )}
    </span>
  );
}

function HeartReadout({ value, device }: { value: number | null; device: boolean }) {
  return (
    <div
      className={styles.heart}
      data-active={value !== null}
      role="img"
      title="Animation indicates data availability, not heartbeat timing."
      aria-label={
        value === null
          ? "Heart rate unavailable. No current device reading."
          : `${value} bpm · ${device ? "received device reading" : "synthetic demo"}`
      }
    >
      <span className={styles.heartFace} aria-hidden="true">
        <svg viewBox="0 0 48 40">
          <path d="M8 0H16V4H20V8H28V4H32V0H40V4H44V8H48V20H44V24H40V28H36V32H32V36H28V40H20V36H16V32H12V28H8V24H4V20H0V8H4V4H8Z" />
        </svg>
        <strong>{value ?? "—"}</strong>
      </span>
      <span aria-hidden="true">
        bpm · {device ? (value === null ? "no data" : "device") : "demo"}
      </span>
    </div>
  );
}

export function OfficerDashboard({
  officer,
  workspace,
  onViewChange,
  person,
  onSelect,
  time,
  running,
  onTogglePlayback,
  onReset,
  theme,
  onToggleTheme,
  map,
  heartRate,
  heartRatePanel,
  capturePanel,
  overview,
  trackingPanel,
  phoneConnected,
  incidentPanel,
}: OfficerDashboardProps) {
  const id = useId();
  const [previewDemo, setPreviewDemo] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const [hadVerifiedSignals, setHadVerifiedSignals] = useState(false);
  const [setupPersonId, setSetupPersonId] = useState(person.id);
  if (setupPersonId !== person.id) {
    setSetupPersonId(person.id);
    setHadVerifiedSignals(false);
    setPreviewDemo(false);
    setSetupOpen(false);
  }
  const [leftWidth, setLeftWidth] = useState(40);
  const [resizing, setResizing] = useState(false);
  const layout = useRef<HTMLDivElement>(null);
  const informationPane = useRef<HTMLElement>(null);
  const gesture = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null);
  const device = heartRate.mode === "device";
  const watchConnected =
    device &&
    heartRate.status === "receiving" &&
    heartRate.receivedAt !== null &&
    Number.isFinite(heartRate.receivedAt) &&
    heartRate.bpm !== null &&
    Number.isFinite(heartRate.bpm) &&
    heartRate.bpm > 0;
  const ready = watchConnected && phoneConnected;
  // Preserve a working briefing if a verified signal later goes stale.
  if (ready && !hadVerifiedSignals) {
    setHadVerifiedSignals(true);
    setPreviewDemo(false);
  }
  const previewEnabled = previewDemo && !ready;
  const briefing = (ready || hadVerifiedSignals || previewDemo) && !setupOpen;
  useEffect(() => {
    informationPane.current?.scrollTo({ top: 0, behavior: "instant" });
  }, [briefing]);
  const bpm = device ? (watchConnected ? heartRate.bpm : null) : sampleHeartRate(person.id, time);
  const vehicle = vehicleAt(person.id, time);
  const watchLabel = watchConnected
    ? "Receiving"
    : device && heartRate.status === "stale"
      ? "Stale"
      : "No signal";
  const clampWidth = (value: number) => Math.min(65, Math.max(35, value));

  function resizeWithKeys(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape" && gesture.current) {
      setLeftWidth(gesture.current.startWidth);
      const pointerId = gesture.current.pointerId;
      gesture.current = null;
      setResizing(false);
      if (event.currentTarget.hasPointerCapture(pointerId))
        event.currentTarget.releasePointerCapture(pointerId);
      return;
    }
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const step = event.shiftKey ? 10 : 2;
    setLeftWidth((value) =>
      event.key === "Home"
        ? 35
        : event.key === "End"
          ? 65
          : clampWidth(value + (event.key === "ArrowLeft" ? -step : step)),
    );
  }

  return (
    <div className={styles.dashboard} data-theme={theme}>
      <a className="skip-link" href="#workspace">
        Skip to workspace
      </a>
      <header className={styles.header}>
        <Link href="/" className={styles.brand} aria-label="Paw Patrol home">
          <span>
            <Shield size={18} aria-hidden="true" />
          </span>
          <strong>Paw Patrol</strong>
        </Link>
        {workspace ? (
          <span className={styles.pinned}>
            <Shield size={13} aria-hidden="true" />
            Officer
          </span>
        ) : (
          <WorkspaceSwitcher onViewChange={onViewChange} />
        )}
        {officer ? (
          <form action="/api/sign-in" method="post" className={styles.account}>
            <span>
              {officer.name} · Badge {officer.badge}
            </span>
            <button type="submit" name="action" value="sign-out">
              Sign out
            </button>
          </form>
        ) : (
          <Link href="/sign-in" className={styles.accountLink}>
            Officer sign-in
          </Link>
        )}
        <span className={styles.workspaceBadge}>Demo workspace</span>
      </header>
      <main id="workspace" className={styles.main}>
        <div className={styles.intro}>
          <h1>Officer workspace</h1>
          <div className={styles.toolbar}>
            <button
              type="button"
              className={styles.iconButton}
              onClick={onToggleTheme}
              aria-label="Toggle officer theme"
              title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
            >
              {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
            </button>
            <span className={styles.clock}>
              <span>{stamp(time)}</span>
              <small>DEMO CLOCK</small>
            </span>
            <button type="button" className={styles.primary} onClick={onTogglePlayback}>
              {running ? (
                <Pause size={14} aria-hidden="true" />
              ) : (
                <Play size={14} aria-hidden="true" />
              )}
              {running ? "Pause demo" : time > 0 ? "Resume demo" : "Run demo"}
            </button>
            <button
              type="button"
              className={styles.iconButton}
              onClick={onReset}
              aria-label="Reset demo"
              title="Reset demo"
            >
              <RotateCcw size={15} />
            </button>
          </div>
        </div>
        <div
          className={styles.layout}
          ref={layout}
          data-resizing={resizing}
          style={{ "--left-width": `${leftWidth}%` } as CSSProperties}
        >
          <section
            id={`${id}-information`}
            ref={informationPane}
            className={styles.information}
            aria-labelledby={`${id}-information-title`}
          >
            <div className={styles.informationHeader}>
              <div>
                <span className={styles.eyebrow}>
                  {briefing
                    ? previewEnabled
                      ? "DEMO PREVIEW"
                      : "OFFICER INFORMATION"
                    : "DEVICE ONBOARDING"}
                </span>
                <h2 id={`${id}-information-title`}>
                  {briefing ? "Incident briefing" : "Connection setup"}
                </h2>
              </div>
              {briefing && (
                <button
                  type="button"
                  className={styles.textButton}
                  onClick={() => setSetupOpen(true)}
                >
                  Device setup
                </button>
              )}
            </div>
            <div className={styles.connectionStrip} aria-label="Device signal status">
              <span data-connected={watchConnected}>
                <Watch size={14} aria-hidden="true" />
                Watch · {watchLabel}
              </span>
              <span
                data-connected={phoneConnected}
                title="Camera preview on this device. Upload status is shown in capture controls."
              >
                <Smartphone size={14} aria-hidden="true" />
                Local iPhone camera · {phoneConnected ? "Active" : "Not connected"}
              </span>
            </div>
            <div className={styles.setup} hidden={briefing}>
              <p className={styles.setupHint}>
                Connect your watch and camera to open the briefing.
              </p>
              <section className={styles.setupSection} aria-labelledby={`${id}-watch`}>
                <div className={styles.setupHeading}>
                  <span>1</span>
                  <h3 id={`${id}-watch`}>Watch / heart-rate sensor</h3>
                  <HeartPulse size={16} aria-hidden="true" />
                </div>
                <div className={styles.devicePanel}>{heartRatePanel}</div>
              </section>
              <section className={styles.setupSection} aria-labelledby={`${id}-phone`}>
                <div className={styles.setupHeading}>
                  <span>2</span>
                  <h3 id={`${id}-phone`}>Phone camera &amp; audio</h3>
                  <Camera size={16} aria-hidden="true" />
                </div>
                <p className={styles.captureHint}>
                  Use your iPhone as a Continuity Camera, choose it in the camera picker, then
                  Start. Use Stop / Mute to end capture.
                </p>
                {capturePanel}
                <p className={styles.phoneLink}>
                  <a href="/capture" target="_blank" rel="noreferrer">
                    Open phone capture page ↗
                  </a>
                  <span>Capture on a phone in a separate tab.</span>
                </p>
              </section>
              <div className={styles.previewAction}>
                <button
                  type="button"
                  className={styles.primary}
                  onClick={() => {
                    if (!ready && !hadVerifiedSignals) setPreviewDemo(true);
                    setSetupOpen(false);
                  }}
                >
                  {ready || hadVerifiedSignals
                    ? "Open incident briefing"
                    : "Preview demo workspace"}
                </button>
                <small>Demo preview works without devices.</small>
              </div>
            </div>
            <div className={styles.briefing} hidden={!briefing}>
              {!ready && (
                <p className={styles.demoNotice} role="status">
                  {previewEnabled
                    ? "Demo preview · devices not connected."
                    : "Device disconnected. Open setup to reconnect."}
                </p>
              )}
              <div className={styles.incidentPanel}>{incidentPanel(previewEnabled)}</div>
              <p className={styles.captureHint}>
                Capture continues in the background. Open device setup to stop it.
              </p>
            </div>
            <div className={styles.support}>
              <div className={styles.overviewSlot}>{overview}</div>
              <details className={styles.tracking}>
                <summary>
                  <Signal size={14} aria-hidden="true" />
                  <span>Live tracking &amp; map details</span>
                  <ChevronDown size={14} aria-hidden="true" />
                </summary>
                <div className={styles.trackingPanel}>{trackingPanel}</div>
              </details>
            </div>
          </section>
          <div
            className={styles.separator}
            role="separator"
            tabIndex={0}
            aria-label="Resize information and map panels"
            aria-orientation="vertical"
            aria-valuemin={35}
            aria-valuemax={65}
            aria-valuenow={Math.round(leftWidth)}
            aria-valuetext={`Information panel ${Math.round(leftWidth)} percent`}
            aria-controls={`${id}-information ${id}-map`}
            title="Drag to resize. Arrow keys adjust; Home / End set limits."
            onKeyDown={resizeWithKeys}
            onPointerDown={(event) => {
              if (event.button !== 0 || !event.isPrimary || gesture.current) return;
              gesture.current = {
                pointerId: event.pointerId,
                startX: event.clientX,
                startWidth: leftWidth,
              };
              event.currentTarget.focus();
              event.currentTarget.setPointerCapture(event.pointerId);
              setResizing(true);
            }}
            onPointerMove={(event) => {
              const active = gesture.current;
              const width = layout.current?.getBoundingClientRect().width;
              if (!active || active.pointerId !== event.pointerId || !width) return;
              event.preventDefault();
              setLeftWidth(
                clampWidth(active.startWidth + ((event.clientX - active.startX) / width) * 100),
              );
            }}
            onPointerUp={(event) => {
              if (gesture.current?.pointerId !== event.pointerId) return;
              gesture.current = null;
              setResizing(false);
            }}
            onPointerCancel={(event) => {
              if (gesture.current?.pointerId !== event.pointerId) return;
              setLeftWidth(gesture.current.startWidth);
              gesture.current = null;
              setResizing(false);
            }}
            onLostPointerCapture={(event) => {
              if (gesture.current?.pointerId !== event.pointerId) return;
              gesture.current = null;
              setResizing(false);
            }}
          >
            <span aria-hidden="true" />
          </div>
          <section id={`${id}-map`} className={styles.mapCard} aria-labelledby={`${id}-map-title`}>
            <div className={styles.cardHeading}>
              <h2 id={`${id}-map-title`}>Patrol map</h2>
              <span className={styles.badge}>15 demo units</span>
              <MapFullscreenButton />
            </div>
            <div className={styles.mapFrame}>
              {map}
              <section className={styles.mapProfile} aria-label="Selected officer quick vitals">
                <div className={styles.profileIdentity}>
                  <OfficerAvatar person={person} />
                  <div>
                    <strong>{person.name}</strong>
                    <span>
                      {person.id} · {personStatus(person.id, time)}
                    </span>
                  </div>
                  <HeartReadout value={bpm} device={device} />
                </div>
                <label className="sr-only" htmlFor={`${id}-person`}>
                  Selected person
                </label>
                <select
                  id={`${id}-person`}
                  value={person.id}
                  onChange={(event) => onSelect(event.target.value)}
                >
                  {PEOPLE.map((officer) => (
                    <option key={officer.id} value={officer.id}>
                      {officer.id} · {officer.name}
                    </option>
                  ))}
                </select>
                <div className={styles.profileFoot}>
                  <span>{person.area}</span>
                  <span>
                    {vehicle.routeId ? Math.round(vehicle.speedMps * 3.6) : "—"} km/h · demo
                  </span>
                </div>
              </section>
            </div>
            <div className={styles.mapCaption}>
              <span>Simulated patrols</span>
              <span>Select a car to inspect</span>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
