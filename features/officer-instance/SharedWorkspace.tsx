"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { LocateFixed, Moon, Sun, X, Shield } from "lucide-react";
import { OperationsMap } from "../paw-patrol/OperationsMap";
import { PEOPLE } from "../paw-patrol/scenario";
import { useScenario } from "../paw-patrol/useScenario";
import { OfficerFeed } from "../paw-patrol/OfficerFeed";
import { HospitalHeartMonitor } from "../paw-patrol/HospitalHeartMonitor";
import type { Workspace } from "../paw-patrol/workspace";
import { BuildingPanel } from "../boston-map/BuildingPanel";
import type { BuildingFacts } from "../boston-map/buildingSelection";
import { api, useInstance } from "./client";
import { useRemoteMedia } from "./useRemoteMedia";
import type { OfficerInstance } from "./types";
import hospitalStyles from "../paw-patrol/HospitalWorkspace.module.css";
import officerStyles from "../paw-patrol/OfficerWorkspace.module.css";
import styles from "./Instance.module.css";

export function SharedWorkspace({ role }: { role: Workspace }) {
  const { snapshot, error } = useInstance(role === "hospital");
  const instance = snapshot?.instance;
  if (role === "hospital")
    return (
      <div className={hospitalStyles.hospital}>
        {instance && instance.lifecycle !== "ended" ? (
          <InstanceFeed key={instance.id} instance={instance} hospital />
        ) : (
          <main className={styles.empty}>
            <h1>No officer requested</h1>
            {error && <p role="status">Connection unavailable</p>}
          </main>
        )}
      </div>
    );
  return (
    <MapWorkspace
      role={role}
      instance={instance?.lifecycle === "ended" ? null : (instance ?? null)}
      error={error}
    />
  );
}
export function InstanceFeed({
  instance,
  hospital = false,
}: {
  instance: OfficerInstance;
  hospital?: boolean;
}) {
  const broadcasting = instance.lifecycle === "broadcasting";
  const { media, error } = useRemoteMedia(
    broadcasting ? instance.id : null,
    instance.media.publisher,
    hospital,
  );
  const latest = instance.heart.at(-1);
  const heart = {
    mode: "device" as const,
    status:
      broadcasting && instance.sources.heart.state === "live" && latest
        ? ("receiving" as const)
        : instance.sources.heart.state === "stale"
          ? ("stale" as const)
          : ("waiting" as const),
    bpm: latest?.bpm ?? null,
    history: instance.heart,
  };
  const cleared = broadcasting && instance.scene.status === "cleared";
  return (
    <section
      className={hospitalStyles.viewport}
      data-cleared={cleared}
      aria-label="Officer camera and audio"
    >
      <OfficerFeed personId={instance.id} input={media} />
      <div className={hospitalStyles.identity}>
        <strong>{instance.displayName}</strong>
        <span>{instance.id}</span>
        <span>{instance.lifecycle}</span>
      </div>
      <HospitalHeartMonitor personId={instance.id} connection={heart} />
      <div className={hospitalStyles.access}>
        {cleared
          ? "Scene clearance reported"
          : instance.scene.status === "unsafe"
            ? "Scene reported unsafe · Hold"
            : "Scene clearance not confirmed · Hold"}
      </div>
      {error && (
        <p className={styles.feedError} role="status">
          {error}
        </p>
      )}
    </section>
  );
}
function MapWorkspace({
  role,
  instance,
  error,
}: {
  role: "officer" | "dispatch";
  instance: OfficerInstance | null;
  error: string | null;
}) {
  const { time, running, readClock, dispatch } = useScenario();
  const [selectedId, setSelectedId] = useState("P-01");
  const [selectedInstance, setSelectedInstance] = useState<string | null>(null);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [recenter, setRecenter] = useState(0);
  const [fix, setFix] = useState<{ longitude: number; latitude: number; nonce: number } | null>(
    null,
  );
  const [building, setBuilding] = useState<BuildingFacts | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const start = setTimeout(() => dispatch({ type: "play" }), 0);
    const visible = () => {
      if (!document.hidden) dispatch({ type: "play" });
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      clearTimeout(start);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [dispatch]);
  useEffect(() => {
    if (selectedInstance && selectedInstance === instance?.id) dialog.current?.showModal();
    else dialog.current?.close();
  }, [selectedInstance, instance?.id]);
  function openInstance() {
    if (!instance) return;
    setSelectedInstance(instance.id);
    if (instance.gps?.fix)
      setFix({
        longitude: instance.gps.fix.longitude,
        latitude: instance.gps.fix.latitude,
        nonce: (fix?.nonce ?? 0) + 1,
      });
  }
  async function command(
    action:
      | { type: "assignment"; requested: boolean }
      | { type: "scene"; status: "unknown" | "unsafe" | "cleared" },
  ) {
    if (!instance) return;
    setBusy(true);
    setMessage(null);
    try {
      await api("/command", { id: instance.id, ...action });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to update instance.");
    } finally {
      setBusy(false);
    }
  }
  const tracked = instance?.lifecycle === "broadcasting" && instance.sources.gps.state !== "unavailable" && instance.gps?.fix
    ? [
        {
          ...instance.gps,
          name: instance.displayName,
          online: instance.lifecycle === "broadcasting",
        },
      ]
    : [];
  return (
    <div className={`paw-app ${officerStyles.officer} ${styles.mapWorkspace}`}>
      <a className="skip-link" href="#workspace">
        Skip to workspace
      </a>
      <header className="topbar">
        <Link className="wordmark" href="/">
          <Shield />
          <span>Paw Patrol</span>
        </Link>
        <nav aria-label="Workspace">
          {(["officer", "dispatch", "hospital"] as const).map((view) => (
            <Link
              key={view}
              href={`/${view}`}
              className={`nav-item ${role === view ? "active" : ""}`}
              aria-current={role === view ? "page" : undefined}
            >
              {view[0].toUpperCase() + view.slice(1)}
            </Link>
          ))}
        </nav>
      </header>
      <main id="workspace">
        <h1 className="sr-only">{role} workspace</h1>
        <OperationsMap
          time={time}
          running={running}
          readClock={readClock}
          selectedId={selectedId}
          onSelect={setSelectedId}
          focus="all"
          theme={theme}
          recenterKey={recenter}
          following={false}
          onStopFollowing={() => {}}
          liveDevices={tracked}
          fixRequest={fix}
          onBuildingSelect={setBuilding}
          onLiveDeviceSelect={openInstance}
        />
        <div className={officerStyles.unitPicker}>
          <label htmlFor="patrol-unit">Patrol demo</label>
          <select
            id="patrol-unit"
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
          >
            {PEOPLE.map((p) => (
              <option value={p.id} key={p.id}>
                {p.id} · {p.name}
              </option>
            ))}
          </select>
        </div>
        <aside className={styles.sharedUnit} aria-label="Shared officer">
          {instance ? (
            <>
              <button className={styles.unitButton} onClick={openInstance}>
                <span
                  className={styles.liveDot}
                  data-live={instance.lifecycle === "broadcasting"}
                />
                <strong>{instance.displayName}</strong>
                <span>{instance.lifecycle} ↗</span>
              </button>
              <code>{instance.id}</code>
              <p>
                {instance.gps?.fix
                  ? `GPS ${instance.gps.fix.freshness} · ${instance.gps.fix.ageSeconds}s ago`
                  : "GPS unavailable"}
              </p>
              {role === "dispatch" && (
                <div className={styles.dispatchActions}>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void command({ type: "assignment", requested: !instance.hospitalRequested })
                    }
                  >
                    {instance.hospitalRequested
                      ? "Clear hospital request"
                      : "Request medical assistance"}
                  </button>
                  <label htmlFor="scene-status">Scene access</label>
                  <select
                    id="scene-status"
                    value={instance.scene.status}
                    disabled={busy}
                    onChange={(e) =>
                      void command({
                        type: "scene",
                        status: e.target.value as "unknown" | "unsafe" | "cleared",
                      })
                    }
                  >
                    <option value="unknown">Clearance not confirmed</option>
                    <option value="unsafe">Report scene unsafe</option>
                    <option value="cleared">Report scene cleared</option>
                  </select>
                </div>
              )}
            </>
          ) : (
            <p>{error ? "Shared officer connection unavailable" : "No shared officer"}</p>
          )}
          {message && <p role="alert">{message}</p>}
        </aside>
        <div className={styles.mapActions}>
          <button
            aria-label="Recenter map"
            onClick={() => {
              if (instance?.gps?.fix) setFix({ ...instance.gps.fix, nonce: (fix?.nonce ?? 0) + 1 });
              else setRecenter((n) => n + 1);
            }}
          >
            <LocateFixed size={18} />
          </button>
          <button
            aria-label="Toggle map theme"
            onClick={() => setTheme((t) => (t === "light" ? "dark" : "light"))}
          >
            {theme === "light" ? <Moon size={18} /> : <Sun size={18} />}
          </button>
        </div>
        {building && (
          <div className={styles.building}>
            <BuildingPanel building={building} onDismiss={() => setBuilding(null)} />
          </div>
        )}
      </main>
      <dialog
        ref={dialog}
        className={`${styles.feedDialog} ${hospitalStyles.hospital}`}
        onClose={() => setSelectedInstance(null)}
      >
        {instance && selectedInstance === instance.id && (
          <InstanceFeed key={instance.id} instance={instance} />
        )}
        <button
          className={styles.closeFeed}
          aria-label="Close officer feed"
          onClick={() => dialog.current?.close()}
        >
          <X size={20} />
        </button>
      </dialog>
    </div>
  );
}
