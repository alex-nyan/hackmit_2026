"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, Check, ShieldAlert, X } from "lucide-react";
import type { DemoHotspot } from "./hotspots";
import type { useDemoAmbulances } from "./useDemoAmbulances";
import { PixelAmbulance } from "./PixelAmbulance";
import styles from "./DispatchAmbulanceTools.module.css";

export function DispatchAmbulanceTools({
  hotspots,
  selectedId,
  onSelect,
  ambulance,
  time,
}: {
  hotspots: DemoHotspot[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  ambulance: ReturnType<typeof useDemoAmbulances>;
  time: number;
}) {
  const [open, setOpen] = useState(false);
  const [confirmEngagement, setConfirmEngagement] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const incidentSelect = useRef<HTMLSelectElement>(null);
  const keepHoldingButton = useRef<HTMLButtonElement>(null);
  const missionAction = useRef<HTMLButtonElement>(null);
  const pendingFocus = useRef<"confirmation" | "action" | null>(null);
  const active = hotspots.filter((item) => item.resolvedAt === null);
  const target = active.find((item) => item.id === selectedId);
  const mission = ambulance.missions.find(
    (item) => item.hotspotId === target?.id && item.status !== "cancelled",
  );
  const remaining = mission
    ? Math.max(0, Math.ceil(mission.duration - (time - mission.startedAt)))
    : 0;

  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal();
  }, [open]);

  useEffect(() => {
    if (!open || !pendingFocus.current) return;
    const next =
      pendingFocus.current === "confirmation" ? keepHoldingButton.current : missionAction.current;
    pendingFocus.current = null;
    (next ?? incidentSelect.current ?? closeButton.current)?.focus();
  });

  function close() {
    pendingFocus.current = null;
    dialog.current?.close();
    setOpen(false);
    setConfirmEngagement(false);
    trigger.current?.focus();
  }

  return (
    <div className={styles.tool}>
      <button
        ref={trigger}
        type="button"
        className={styles.trigger}
        onClick={() => {
          if (!target && active.length === 1) onSelect(active[0].id);
          setConfirmEngagement(false);
          setOpen(true);
        }}
      >
        <PixelAmbulance />
        <span>
          <strong>Engage ambulance</strong>
          <small>Select a flag · confirm dispatch</small>
          <small>Demo response only</small>
        </span>
      </button>
      {open && (
        <dialog
          ref={dialog}
          className={styles.dialog}
          aria-labelledby="ambulance-dialog-title"
          onCancel={(event) => {
            event.preventDefault();
            close();
          }}
          onClick={(event) => {
            if (event.target === event.currentTarget) close();
          }}
        >
          <div className={styles.content}>
            <header>
              <span className={styles.eyebrow}>SIMULATED MEDICAL RESPONSE</span>
              <button ref={closeButton} aria-label="Close ambulance controls" onClick={close}>
                <X size={18} />
              </button>
            </header>
            <h2 id="ambulance-dialog-title">Engage ambulance</h2>
            {active.length ? (
              <>
                <label className={styles.selectLabel}>
                  Incident flag
                  <select
                    ref={incidentSelect}
                    value={target?.id ?? ""}
                    onChange={(event) => {
                      onSelect(event.target.value);
                      setConfirmEngagement(false);
                    }}
                  >
                    <option value="" disabled>
                      Choose a hotspot
                    </option>
                    {active.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.id} · {item.point[1].toFixed(4)}, {item.point[0].toFixed(4)}
                      </option>
                    ))}
                  </select>
                </label>
                {target && (
                  <p className={styles.location}>
                    {target.id} · {target.point[1].toFixed(5)}, {target.point[0].toFixed(5)}
                  </p>
                )}
                {mission ? (
                  <>
                    <div className={styles.mission} data-state={mission.status}>
                      <PixelAmbulance />
                      <div>
                        <strong>
                          {mission.id} → {mission.hotspotId}
                        </strong>
                        <span>{mission.stationName}</span>
                        <b>
                          {mission.status === "en-route"
                            ? `En route · ${remaining}s demo ETA`
                            : mission.status === "staged"
                              ? "Arrived nearby · HOLD"
                              : "Medics authorized · demo"}
                        </b>
                      </div>
                    </div>
                    {mission.status === "en-route" && (
                      <p>
                        Accelerated demo route. On arrival, the crew will stage nearby and wait.
                      </p>
                    )}
                    {mission.status === "staged" && (
                      <>
                        <p className={styles.hold}>
                          <ShieldAlert size={18} /> Hold at the staging point. Arrival is not
                          permission to enter.
                        </p>
                        {confirmEngagement ? (
                          <div className={styles.confirm}>
                            <strong>Authorize demo medics for {mission.hotspotId}?</strong>
                            <p>
                              Confirm that you have reviewed the scene and want the simulated crew
                              to engage. Model observations cannot authorize entry.
                            </p>
                            <div className={styles.actions}>
                              <button
                                ref={keepHoldingButton}
                                onClick={() => {
                                  pendingFocus.current = "action";
                                  setConfirmEngagement(false);
                                }}
                              >
                                Keep holding
                              </button>
                              <button
                                className={styles.primary}
                                onClick={() => {
                                  pendingFocus.current = "action";
                                  ambulance.engageMedics(mission.id);
                                  setConfirmEngagement(false);
                                }}
                              >
                                <Check size={15} /> Authorize for {mission.hotspotId}
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button
                            ref={missionAction}
                            className={styles.primary}
                            onClick={() => {
                              pendingFocus.current = "confirmation";
                              setConfirmEngagement(true);
                            }}
                          >
                            Authorize medic engagement <ArrowRight size={15} />
                          </button>
                        )}
                      </>
                    )}
                    {mission.status === "engaged" && (
                      <>
                        <p>
                          Operator authorization recorded for this flag. The health dashboard
                          receives this demo handoff; no real crew is contacted.
                        </p>
                        <button
                          ref={missionAction}
                          className={styles.primary}
                          onClick={() => {
                            pendingFocus.current = "action";
                            ambulance.holdMedics(mission.id);
                            setConfirmEngagement(false);
                          }}
                        >
                          <ShieldAlert size={15} /> Send STOP / hold medics
                        </button>
                      </>
                    )}
                  </>
                ) : (
                  <>
                    <p>
                      {target
                        ? `Dispatch a demo ambulance to ${target.id}?`
                        : "Choose the exact flag before dispatching."}
                    </p>
                    <p>
                      It will leave an available fictional health centre, stage near this location,
                      and await your separate engagement authorization.
                    </p>
                    <button
                      className={styles.primary}
                      disabled={!target}
                      onClick={() => {
                        if (target) {
                          ambulance.dispatchAmbulance(target.id);
                        }
                      }}
                    >
                      Confirm dispatch{target ? ` to ${target.id}` : ""} <ArrowRight size={15} />
                    </button>
                  </>
                )}
              </>
            ) : (
              <p>Place a hotspot flag on the map first.</p>
            )}
            <p role="status" className={styles.message}>
              {target &&
              ambulance.feedback?.hotspotId === target.id &&
              ambulance.feedback.missionId === (mission?.id ?? null)
                ? ambulance.feedback.message
                : ""}
            </p>
            <footer>Demo only · not a real dispatch or scene clearance.</footer>
          </div>
        </dialog>
      )}
    </div>
  );
}
