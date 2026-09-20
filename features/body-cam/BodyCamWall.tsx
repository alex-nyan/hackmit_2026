"use client";

import { useEffect, useState } from "react";

import { LiveTile } from "@/features/live-video";
import type { WatchState } from "@/features/live-video/useLiveWatcher";

import styles from "./BodyCamWall.module.css";
import { FrameReview } from "./FrameReview";
import { ageMs, type FrameSummary } from "./frames";
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
 * One officer's tile.
 *
 * Its own component because each tile holds its own connection to that
 * officer's camera, and a connection is a hook. What it shows is whichever of
 * the two is real: a direct video link where the browsers managed to find
 * each other, and otherwise the last frame that officer uploaded, labelled
 * with its age as it always was.
 */
function WallTile({
  frame,
  age,
  open,
  onOpen,
}: {
  frame: FrameSummary;
  age: number;
  open: boolean;
  onOpen: () => void;
}) {
  const [live, setLive] = useState(false);
  const [streamState, setStreamState] = useState<WatchState>("idle");

  return (
    <figure className={styles.tile} key={frame.sourceId}>
      {/* A tile is a way into that officer's recent footage. */}
      <button
        type="button"
        className={styles.tileButton}
        onClick={onOpen}
        aria-expanded={open}
        aria-label={`Review footage from ${frame.sourceId}`}
      >
        <LiveTile
          sourceId={frame.sourceId}
          className={styles.shot}
          onLiveChange={setLive}
          onStateChange={setStreamState}
          alt={
            live
              ? `Live camera from ${frame.sourceId}`
              : `Latest frame published by ${frame.sourceId}`
          }
          // The browser fetches each frame, so one officer's upload is not
          // multiplied by the number of people watching.
          fallbackSrc={`/api/streams/${encodeURIComponent(frame.sourceId)}/frame?live=${Date.parse(frame.at)}`}
        />
        <figcaption className={styles.caption}>
          <span className={styles.unit}>{frame.sourceId}</span>
          {/* Video has no age to report, and a still must never borrow the
              word that belongs to video. */}
          {live ? (
            <span className={styles.live}>LIVE</span>
          ) : streamState === "connecting" ? (
            <span className={styles.connecting}>CONNECTING</span>
          ) : (
            <span className={styles.age} data-freshness={freshness(age)}>
              {describeAge(age)}
            </span>
          )}
        </figcaption>
        {/* A machine transcript, and labelled as one: it mishears, and silence
            is indistinguishable from speech it failed to recognise. */}
        {frame.heard && (
          <p className={styles.heard}>
            <span className={styles.heardLabel}>Heard</span>
            {frame.heard}
          </p>
        )}
      </button>
    </figure>
  );
}

/**
 * Every officer currently publishing, as their latest frame.
 *
 * This is not video and is not presented as video. Each tile is the last
 * still that officer's capture page uploaded, roughly one every two seconds,
 * labelled with its own age — a dispatcher can see at a glance which feeds are
 * current and which have gone quiet. A source that stops publishing leaves the
 * wall instead of freezing on its final frame.
 */
export interface BodyCamWallProps {
  /**
   * Leave this unit off the wall. A phone watching from the capture page wants
   * the other officers, not its own camera handed back to it a second late.
   */
  excludeSourceId?: string;
  /**
   * Chrome to sit inside. The dashboard's cream card by default; the capture
   * page passes its own class because it is dark all the way down.
   */
  className?: string;
}

export function BodyCamWall({ excludeSourceId, className = "panel" }: BodyCamWallProps = {}) {
  const { frames: published, status } = useBodyCamWall();
  const [now, setNow] = useState(() => Date.now());
  const frames = excludeSourceId
    ? published.filter((frame) => frame.sourceId !== excludeSourceId)
    : published;
  const watching = excludeSourceId !== undefined;
  const [reviewing, setReviewing] = useState<string | null>(null);

  useEffect(() => {
    // Age is the passage of time, so nothing else would re-render these.
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, []);

  return (
    <section className={className} aria-label="Body camera wall">
      <div className="panel-heading">
        <h2>
          {watching ? "Other units" : "Body cameras"} · {frames.length} publishing
        </h2>
        <span className={`tag ${status === "live" ? "sky" : "sage"}`}>{STATUS_COPY[status]}</span>
      </div>

      {frames.length === 0 ? (
        <p className={styles.empty}>
          {watching ? (
            <>
              Nobody else is publishing yet. When another unit starts their camera on{" "}
              <strong>/capture</strong>, their view appears here.
            </>
          ) : (
            <>
              No officer is publishing. Open <strong>/capture</strong> on a phone or a laptop with a
              paired camera, name the unit, and start the camera — the frames it sends for triage
              appear here.
            </>
          )}
        </p>
      ) : (
        <div className={styles.wall}>
          {frames.map((frame) => (
            <WallTile
              key={frame.sourceId}
              frame={frame}
              age={ageMs(frame, now)}
              open={frame.sourceId === reviewing}
              onOpen={() => setReviewing(frame.sourceId === reviewing ? null : frame.sourceId)}
            />
          ))}
        </div>
      )}

      {/* Keyed by officer: a different timeline is a different component,
          which is what resets the scrubber without an effect to do it. */}
      {reviewing && (
        <FrameReview key={reviewing} sourceId={reviewing} onClose={() => setReviewing(null)} />
      )}

      <p className={styles.caveat}>
        A tile marked LIVE is a direct video link to that camera. Any other tile is that
        officer&apos;s latest uploaded still, about one every two seconds, labelled with its own age
        — a link that could not be made is not a camera that stopped. Select a tile to scrub the
        last fifteen minutes of stills; nothing older is kept, and live video is never recorded.
      </p>
    </section>
  );
}
