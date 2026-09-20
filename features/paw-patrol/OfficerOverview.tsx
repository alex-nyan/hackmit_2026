"use client";

import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { ChevronDown, Shield, X } from "lucide-react";
import type { HeartRateConnection, HeartRateSample } from "../heart-rate/useHeartRate";
import { PEOPLE, personStatus, sampleHeartRate, type Person } from "./scenario";
import styles from "./OfficerOverview.module.css";

interface Props {
  person: Person;
  onSelect: (id: string) => void;
  time: number;
  running: boolean;
  heartRate: HeartRateConnection;
}

const PULSE_PATH =
  "M0 28H10Q13 28 15 25Q18 20 21 25L23 28H29L32 31L36 7L41 38L45 28H52Q56 20 61 24Q65 28 70 28H80";

function DemoPulse({ bpm, running, index }: { bpm: number; running: boolean; index: number }) {
  const beatSeconds = 60 / Math.max(1, bpm);
  return (
    <span className={styles.trace} aria-hidden="true">
      <svg
        className={styles.pulseTrack}
        viewBox="0 0 480 44"
        preserveAspectRatio="none"
        data-running={running}
        style={
          {
            "--pulse-duration": `${beatSeconds * 3}s`,
            animationDelay: `${-index * beatSeconds * 0.19}s`,
          } as CSSProperties
        }
      >
        {Array.from({ length: 6 }, (_, beat) => (
          <path key={beat} d={PULSE_PATH} transform={`translate(${beat * 80} 0)`} />
        ))}
      </svg>
    </span>
  );
}

function DeviceTrend({ history }: { history: HeartRateSample[] }) {
  const samples = history.filter(
    (sample) => Number.isFinite(sample.bpm) && Number.isFinite(sample.receivedAt),
  );
  if (samples.length < 2) {
    return <span className={styles.noTrend}>Waiting for received trend</span>;
  }
  const minimum = Math.min(...samples.map((sample) => sample.bpm)) - 5;
  const range = Math.max(...samples.map((sample) => sample.bpm)) + 5 - minimum;
  const firstAt = samples[0].receivedAt;
  const elapsed = samples[samples.length - 1].receivedAt - firstAt;
  const points = samples
    .map((sample, index) => {
      const x =
        elapsed > 0
          ? ((sample.receivedAt - firstAt) / elapsed) * 300
          : (index / (samples.length - 1)) * 300;
      return `${x},${38 - ((sample.bpm - minimum) / range) * 32}`;
    })
    .join(" ");
  return (
    <span className={styles.trace}>
      <svg
        viewBox="0 0 300 44"
        preserveAspectRatio="none"
        role="img"
        aria-label="Received heart rate trend"
      >
        <title>Received BPM by browser receipt time, not an ECG</title>
        <polyline points={points} />
      </svg>
    </span>
  );
}

/** Read-only demo roster. The selected profile shares the existing local heart-rate session. */
export function OfficerOverview({ person, onSelect, time, running, heartRate }: Props) {
  const [open, setOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const rosterRef = useRef<HTMLUListElement>(null);
  const id = useId();
  const panelId = `${id}-panel`;
  const headingId = `${id}-heading`;
  const selectId = `${id}-officer`;

  // Keep the selected row visible without scrolling the map or the outer page.
  useEffect(() => {
    const roster = rosterRef.current;
    if (!open || !roster) return;
    const selected = roster.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (!selected) return;
    const listBounds = roster.getBoundingClientRect();
    const rowBounds = selected.getBoundingClientRect();
    if (rowBounds.top < listBounds.top + 6) {
      roster.scrollTop -= listBounds.top + 6 - rowBounds.top;
    } else if (rowBounds.bottom > listBounds.bottom - 6) {
      roster.scrollTop += rowBounds.bottom - listBounds.bottom + 6;
    }
  }, [open, person.id]);

  function close() {
    setOpen(false);
    toggleRef.current?.focus();
  }

  return (
    <div
      className={styles.overview}
      data-overview-open={open}
      onKeyDown={(event) => {
        if (open && event.key === "Escape") {
          event.stopPropagation();
          close();
        }
      }}
    >
      <button
        ref={toggleRef}
        className={styles.toggle}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
      >
        <Shield size={17} aria-hidden="true" />
        Officer overview
        <ChevronDown size={15} aria-hidden="true" className={open ? styles.expanded : undefined} />
      </button>
      {open && (
        <section id={panelId} aria-labelledby={headingId} className={styles.panel}>
          <div className={styles.heading}>
            <div>
              <h2 id={headingId}>Officer overview</h2>
              <p>{PEOPLE.length} demo units · select an officer</p>
            </div>
            <button
              className={styles.close}
              type="button"
              aria-label="Close officer overview"
              onClick={close}
            >
              <X size={18} aria-hidden="true" />
            </button>
          </div>
          <label htmlFor={selectId} className={styles.selectLabel}>
            Overview officer
          </label>
          <select
            id={selectId}
            className={styles.select}
            value={person.id}
            onChange={(event) => onSelect(event.target.value)}
          >
            {PEOPLE.map((officer) => (
              <option key={officer.id} value={officer.id}>
                {officer.id} · {officer.name}
              </option>
            ))}
          </select>
          <p className={styles.disclaimer}>
            Fictional officers and demo status. Animated traces are illustrative pulses, not
            measured ECGs.
          </p>
          <ul ref={rosterRef} className={styles.roster} aria-label="Officer roster">
            {PEOPLE.map((officer, index) => {
              const selected = officer.id === person.id;
              const device = selected && heartRate.mode === "device";
              const current = device
                ? heartRate.status === "receiving"
                  ? heartRate.bpm
                  : null
                : sampleHeartRate(officer.id, time);
              const source = device
                ? heartRate.status === "receiving" && current !== null
                  ? "Live device"
                  : `${heartRate.status} · no current reading`
                : "Simulated";
              return (
                <li key={officer.id}>
                  <button
                    type="button"
                    className={styles.row}
                    aria-pressed={selected}
                    data-officer-id={officer.id}
                    data-source={device ? "device" : "demo"}
                    onClick={() => onSelect(officer.id)}
                  >
                    <span className={styles.rowTop}>
                      <span className={styles.identity}>
                        <strong>{officer.name}</strong>
                        <span>
                          {officer.id} <span aria-hidden="true">·</span>{" "}
                          {personStatus(officer.id, time)}
                        </span>
                      </span>
                      <span className={styles.reading}>
                        <strong>{current ?? "--"}</strong>
                        <span>bpm</span>
                      </span>
                    </span>
                    {device ? (
                      <DeviceTrend history={heartRate.history} />
                    ) : (
                      <DemoPulse bpm={current!} running={running} index={index} />
                    )}
                    <span className={styles.rowFoot}>
                      <span>{source}</span>
                      <span>
                        {device
                          ? heartRate.status === "receiving"
                            ? "Received BPM · not ECG"
                            : "Past received BPM · not ECG"
                          : "Illustrative pulse · not ECG"}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {heartRate.mode === "device" && (
            <p className={styles.disclaimer}>
              Device readings belong only to the connected tester, not verified officer identity.
              Other units remain simulated.
            </p>
          )}
        </section>
      )}
    </div>
  );
}
