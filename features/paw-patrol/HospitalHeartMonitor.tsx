"use client";

import { useEffect, useState } from "react";
import type { HeartRateConnection, HeartRateSample } from "../heart-rate/useHeartRate";
import { sampleHeartRate } from "./scenario";
import styles from "./HospitalWorkspace.module.css";

const WINDOW_MS = 60_000;

/** A display-only preview; never sent to the device store or incident bus. */
export function previewBpm(personId: string, second: number) {
  return (
    sampleHeartRate(personId, 0) +
    Math.round(
      2 * Math.sin(second * 0.29) + 1.5 * Math.sin(second * 0.91) + Math.sin(second * 1.73),
    )
  );
}

export function HospitalHeartMonitor({
  personId,
  connection,
}: {
  personId: string;
  connection: Pick<HeartRateConnection, "mode" | "status" | "history" | "bpm">;
}) {
  const [clock, setClock] = useState({ tick: 0, now: null as number | null });
  useEffect(() => {
    const started = Date.now();
    const interval = setInterval(
      () =>
        setClock({
          tick: Math.floor((Date.now() - started) / 1000),
          now: Date.now(),
        }),
      1000,
    );
    return () => clearInterval(interval);
  }, []);

  const preview = connection.mode === "demo";
  const end = preview
    ? clock.tick * 1000
    : (clock.now ?? connection.history.at(-1)?.receivedAt ?? 0);
  const samples: HeartRateSample[] = preview
    ? Array.from({ length: 61 }, (_, index) => ({
        bpm: previewBpm(personId, clock.tick - 60 + index),
        receivedAt: (clock.tick - 60 + index) * 1000,
      }))
    : connection.history.filter(
        (sample) => sample.receivedAt >= end - WINDOW_MS && sample.receivedAt <= end,
      );
  const values = samples.map((sample) => sample.bpm);
  const low = values.length ? Math.floor((Math.min(...values) - 4) / 5) * 5 : 60;
  const high = values.length ? Math.ceil((Math.max(...values) + 4) / 5) * 5 : 100;
  const x = (sample: HeartRateSample) => ((sample.receivedAt - end + WINDOW_MS) / WINDOW_MS) * 268;
  const y = (bpm: number) => 8 + ((high - bpm) / (high - low)) * 84;
  // Leave gaps where the device supplied no readings; never add interpolated samples.
  const segments: HeartRateSample[][] = [];
  for (const sample of samples) {
    const last = segments.at(-1);
    if (!last || sample.receivedAt - last.at(-1)!.receivedAt > 5000) segments.push([sample]);
    else last.push(sample);
  }
  const current = preview
    ? previewBpm(personId, clock.tick)
    : connection.status === "receiving"
      ? connection.bpm
      : null;
  const last = samples.at(-1);

  return (
    <section className={styles.heart} aria-label="Heart monitor">
      <div className={styles.monitorHeading}>
        <h2>Heart rate</h2>
        <span>
          {preview
            ? "Preview"
            : connection.status === "receiving"
              ? "Live"
              : connection.status === "stale"
                ? "Stale"
                : "No reading"}
        </span>
      </div>
      <div className={styles.reading} aria-label="Selected person heart rate">
        <strong>{current ?? "--"}</strong>
        <span>bpm</span>
      </div>
      <svg
        className={styles.trend}
        viewBox="0 0 300 104"
        role="img"
        aria-label={preview ? "Synthetic heart rate trend" : "Received heart rate trend"}
      >
        <title>
          {preview
            ? "Preview heart rate over 60 seconds"
            : "Received heart rate over 60 seconds; not an ECG"}
        </title>
        {[high, (high + low) / 2, low].map((value) => (
          <g key={value}>
            <line x1="0" x2="268" y1={y(value)} y2={y(value)} className={styles.gridLine} />
            <text x="300" y={y(value) + 3} textAnchor="end">
              {Math.round(value)}
            </text>
          </g>
        ))}
        {segments.map((segment, index) => (
          <polyline
            key={index}
            points={segment.map((sample) => `${x(sample)},${y(sample.bpm)}`).join(" ")}
            className={styles.trendLine}
          />
        ))}
        {last && <circle cx={x(last)} cy={y(last.bpm)} r="3" className={styles.trendPoint} />}
      </svg>
      <div className={styles.chartTimes}>
        <span>60s ago</span>
        <span>Now</span>
      </div>
      {!preview && !samples.length && <p className={styles.noReadings}>Waiting for readings</p>}
    </section>
  );
}
