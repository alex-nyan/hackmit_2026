"use client";

import { useEffect, useState } from "react";

import styles from "./BodyCamWall.module.css";
import { ageMs } from "./frames";
import { useBodyCamWall } from "./useBodyCamWall";

const TICK_MS = 1_000;
const FRESH_MS = 4_000;
const AGING_MS = 10_000;

export function freshness(age: number): "fresh" | "aging" | "stale" {
  if (age <= FRESH_MS) return "fresh";
  if (age <= AGING_MS) return "aging";
  return "stale";
}

export function describeAge(age: number): string {
  if (!Number.isFinite(age)) return "age unknown";
  const seconds = Math.round(age / 1000);
  return seconds <= 1 ? "just now" : `${seconds}s ago`;
}

const STATUS_COPY = {
  live: "LIVE",
  connecting: "CONNECTING",
  offline: "NOT SYNCED",
} as const;

/**
 * Every officer currently publishing, as their latest frame.
 *
 * This is not video and is not presented as video. Each tile is the last
 * still that officer's capture page uploaded, roughly one every two seconds,
 * labelled with its own age — a dispatcher can see at a glance which feeds are
 * current and which have gone quiet. A source that stops publishing leaves the
 * wall instead of freezing on its final frame.
 */
export function BodyCamWall() {
  const { frames, status } = useBodyCamWall();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    // Age is the passage of time, so nothing else would re-render these.
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, []);

  return (
    <section className="panel" aria-label="Body camera wall">
      <div className="panel-heading">
        <h2>Body cameras · {frames.length} publishing</h2>
        <span className={`tag ${status === "live" ? "sky" : "sage"}`}>{STATUS_COPY[status]}</span>
      </div>

      {frames.length === 0 ? (
        <p className={styles.empty}>
          No officer is publishing. Open <strong>/capture</strong> on a phone or a laptop with a
          paired camera, name the unit, and start the camera — the frames it sends for triage appear
          here.
        </p>
      ) : (
        <div className={styles.wall}>
          {frames.map((frame) => {
            const age = ageMs(frame, now);
            return (
              <figure className={styles.tile} key={frame.sourceId}>
                {/* The browser fetches each frame, so one officer's upload is
                    not multiplied by the number of people watching. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  className={styles.shot}
                  src={`/api/streams/${encodeURIComponent(frame.sourceId)}/frame?at=${encodeURIComponent(frame.at)}`}
                  alt={`Latest frame published by ${frame.sourceId}`}
                />
                <figcaption className={styles.caption}>
                  <span className={styles.unit}>{frame.sourceId}</span>
                  <span className={styles.age} data-freshness={freshness(age)}>
                    {describeAge(age)}
                  </span>
                </figcaption>
              </figure>
            );
          })}
        </div>
      )}

      <p className={styles.caveat}>
        Latest frame per officer, about one every two seconds. These are stills, not a live video
        feed, and each is labelled with its own age.
      </p>
    </section>
  );
}
