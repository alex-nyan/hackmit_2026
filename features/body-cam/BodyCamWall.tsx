"use client";

import { useCallback, useEffect, useState } from "react";

import { LiveTile } from "@/features/live-video";
import { LiveDiagnostics } from "@/features/live-video/LiveDiagnostics";
import type { WatchState } from "@/features/live-video/useLiveWatcher";

import styles from "./BodyCamWall.module.css";
import { FrameReview } from "./FrameReview";
import { ageMs } from "./frames";
import { useBodyCamWall, type WallSource } from "./useBodyCamWall";

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
  live: "SYNCED",
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
  source,
  age,
  open,
  onOpen,
  onMediaChange,
}: {
  source: WallSource;
  age: number;
  open: boolean;
  onOpen: () => void;
  onMediaChange: (sourceId: string, live: boolean) => void;
}) {
  const { sourceId, frame } = source;
  const [live, setLive] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [streamState, setStreamState] = useState<WatchState>("idle");
  const updateLive = useCallback(
    (arriving: boolean) => {
      setLive(arriving);
      onMediaChange(sourceId, arriving);
    },
    [onMediaChange, sourceId],
  );

  useEffect(() => () => onMediaChange(sourceId, false), [onMediaChange, sourceId]);

  return (
    <figure className={styles.tile}>
      {/* A tile is a way into that officer's recent footage. */}
      <button
        type="button"
        className={styles.tileButton}
        onClick={onOpen}
        aria-expanded={open}
        aria-label={`Review footage from ${sourceId}`}
      >
        <LiveTile
          sourceId={sourceId}
          className={styles.shot}
          onLiveChange={updateLive}
          onStateChange={setStreamState}
          audioEnabled={audioEnabled}
          alt={live ? `Live camera from ${sourceId}` : `Latest frame published by ${sourceId}`}
          // The browser fetches each frame, so one officer's upload is not
          // multiplied by the number of people watching.
          fallbackSrc={
            frame
              ? `/api/streams/${encodeURIComponent(sourceId)}/frame?live=${Date.parse(frame.at)}`
              : undefined
          }
        />
        <figcaption className={styles.caption}>
          <span className={styles.unit}>{sourceId}</span>
          {/* Video has no age to report, and a still must never borrow the
              word that belongs to video. */}
          {live ? (
            <span className={styles.live}>LIVE</span>
          ) : frame ? (
            <span className={styles.age} data-freshness={freshness(age)}>
              Still · {describeAge(age)}
            </span>
          ) : (
            <span className={styles.connecting}>
              {streamState === "connecting" ? "CONNECTING" : "NO LIVE VIDEO"}
            </span>
          )}
        </figcaption>
        {/* A machine transcript, and labelled as one: it mishears, and silence
            is indistinguishable from speech it failed to recognise. */}
        {frame?.heard && (
          <p className={styles.heard}>
            <span className={styles.heardLabel}>Heard</span>
            {frame.heard}
          </p>
        )}
      </button>
      {live && (
        <label className={styles.caption}>
          <span>Listen to shared audio</span>
          <input
            type="checkbox"
            checked={audioEnabled}
            onChange={(event) => setAudioEnabled(event.target.checked)}
          />
        </label>
      )}
    </figure>
  );
}

/**
 * Discovery joins independent camera leases with the latest available stills.
 * Actual arriving media keeps its tile alive even if discovery is interrupted.
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
  const { sources: published, status, setSourceLive } = useBodyCamWall();
  const [now, setNow] = useState(() => Date.now());
  const sources = excludeSourceId
    ? published.filter((source) => source.sourceId !== excludeSourceId)
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
          {watching ? "Other units" : "Body cameras"} · {sources.length} sources
        </h2>
        <span className={`tag ${status === "live" ? "sky" : "sage"}`}>{STATUS_COPY[status]}</span>
      </div>

      {sources.length === 0 ? (
        <p className={styles.empty}>
          {watching ? (
            <>
              Nobody else is publishing yet. When another unit starts their camera on{" "}
              <strong>/capture</strong>, their view appears here.
            </>
          ) : (
            <>
              No officer is publishing. Open <strong>/capture</strong> on a phone or a laptop with a
              paired camera, name the unit, and start the camera — their live view appears here.
            </>
          )}
        </p>
      ) : (
        <div className={styles.wall}>
          {sources.map((source) => (
            <WallTile
              key={source.sourceId}
              source={source}
              age={source.frame ? ageMs(source.frame, now) : Number.POSITIVE_INFINITY}
              open={source.sourceId === reviewing}
              onOpen={() => setReviewing(source.sourceId === reviewing ? null : source.sourceId)}
              onMediaChange={setSourceLive}
            />
          ))}
        </div>
      )}

      {/* Keyed by officer: a different timeline is a different component,
          which is what resets the scrubber without an effect to do it. */}
      {reviewing && (
        <FrameReview key={reviewing} sourceId={reviewing} onClose={() => setReviewing(null)} />
      )}

      <LiveDiagnostics />

      <p className={styles.caveat}>
        LIVE means video frames are arriving from that camera. A still is labelled with its own age;
        image analysis can delay still updates without interrupting live video. Select a tile to
        scrub the last fifteen minutes of stills; nothing older is kept, and live video is never
        recorded.
      </p>
    </section>
  );
}
