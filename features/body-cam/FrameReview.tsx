"use client";

import { useState } from "react";

import styles from "./BodyCamWall.module.css";
import { useFrameHistory } from "./useFrameHistory";

function clockOf(atMs: number): string {
  return new Date(atMs).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/**
 * Scrubbing back through one officer's recent frames.
 *
 * This is the one place the wall keeps anything, so it is explicit about
 * what it is: a short rolling window of stills at the wall's own cadence,
 * not continuous video and not a record anyone should treat as evidence.
 */
export function FrameReview({ sourceId, onClose }: { sourceId: string; onClose: () => void }) {
  const { frames, status } = useFrameHistory(sourceId);
  const [selectedAt, setSelectedAt] = useState<number | null>(null);

  // Keep the selected moment when older frames leave the rolling history.
  // Follow the newest frame only until the reviewer takes hold of the scrubber.
  const position =
    selectedAt === null ? Math.max(frames.length - 1, 0) : frames.indexOf(selectedAt);
  const expired = selectedAt !== null && position === -1;
  const at = frames[position];

  return (
    <section className={styles.review} aria-label={`Review footage from ${sourceId}`}>
      <div className={styles.reviewHead}>
        <strong>{sourceId}</strong>
        <span className={styles.reviewClock}>
          {at
            ? clockOf(at)
            : expired
              ? "Selected frame unavailable"
              : status === "loading"
                ? "Loading…"
                : "No footage"}
        </span>
        <button type="button" className={styles.reviewClose} onClick={onClose}>
          Close
        </button>
      </div>

      {status === "unavailable" && (
        <p className={styles.connecting} role="status">
          History updates unavailable{at ? " · showing previously received footage" : ""}
        </p>
      )}

      {at ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className={styles.reviewShot}
          src={`/api/streams/${encodeURIComponent(sourceId)}/frame?at=${at}`}
          alt={`Frame published by ${sourceId} at ${clockOf(at)}`}
        />
      ) : (
        <p className={styles.empty}>
          {expired
            ? "The selected frame expired or was removed. Return to live to view the latest available footage."
            : status === "unavailable"
              ? "That officer's history could not be read."
              : "Nothing recorded for this officer yet."}
        </p>
      )}

      {frames.length > 1 && !expired && (
        <input
          className={styles.reviewScrub}
          type="range"
          min={0}
          max={frames.length - 1}
          value={position}
          onChange={(event) => setSelectedAt(frames[Number(event.target.value)] ?? null)}
          aria-label={`Scrub ${sourceId} footage`}
        />
      )}

      <div className={styles.reviewFoot}>
        <span>
          {frames.length} frame{frames.length === 1 ? "" : "s"}
          {frames.length > 0 && ` · ${clockOf(frames[0])} to ${clockOf(frames[frames.length - 1])}`}
        </span>
        {selectedAt !== null && (
          <button type="button" className={styles.reviewClose} onClick={() => setSelectedAt(null)}>
            Back to live
          </button>
        )}
      </div>
    </section>
  );
}
