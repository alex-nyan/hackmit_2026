"use client";

import { useEffect, useId, useState } from "react";
import { Camera, History, Radio, VideoOff } from "lucide-react";
import { useBodyCamWall } from "../body-cam/useBodyCamWall";
import { FrameReview } from "../body-cam/FrameReview";
import type { FrameSummary } from "../body-cam/frames";
import { isValidToken } from "../camera-triage/frame";
import { OfficerFeed, type OfficerMediaInput } from "./OfficerFeed";
import styles from "./HospitalAssessment.module.css";
import hospitalStyles from "./HospitalWorkspace.module.css";

function validFrame(value: unknown): value is FrameSummary {
  if (!value || typeof value !== "object") return false;
  const frame = value as Record<string, unknown>;
  return (
    typeof frame.sourceId === "string" &&
    isValidToken(frame.sourceId) &&
    typeof frame.at === "string" &&
    Number.isFinite(Date.parse(frame.at)) &&
    typeof frame.bytes === "number" &&
    Number.isFinite(frame.bytes) &&
    frame.bytes > 0 &&
    (frame.heard === undefined || typeof frame.heard === "string")
  );
}

/** Read existing published media only. Never starts a camera, microphone, or upload. */
export function HospitalSceneFeed({
  personId,
  media,
}: {
  personId: string;
  media?: OfficerMediaInput | null;
}) {
  return media?.personId === personId ? (
    <section
      className={`${styles.scene} ${hospitalStyles.clinicalScene}`}
      aria-label="Scene footage"
    >
      <header className={styles.cardHeader}>
        <h2>
          <Camera size={16} aria-hidden="true" /> Scene footage
        </h2>
        <span>{personId} · remote stream</span>
      </header>
      <div className={styles.remoteVideo}>
        <OfficerFeed personId={personId} input={media} />
      </div>
    </section>
  ) : (
    <PublishedScene key={personId} personId={personId} />
  );
}

function PublishedScene({ personId }: { personId: string }) {
  const sourceId = useId();
  const { frames: received, status } = useBodyCamWall();
  const [chosen, setChosen] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const update = () => setNow(Date.now());
    const frame = requestAnimationFrame(update);
    const timer = setInterval(update, 1000);
    return () => {
      cancelAnimationFrame(frame);
      clearInterval(timer);
    };
  }, []);
  const frames = received
    .filter(validFrame)
    .filter(
      (frame, index, all) => all.findIndex((item) => item.sourceId === frame.sourceId) === index,
    );
  // Never substitute another officer when a source disappears. Source IDs are
  // publisher labels, not independently verified identities or patient links.
  const selectedSource = chosen ?? `officer-${personId}`;
  const selected = frames.find((frame) => frame.sourceId === selectedSource);
  const age = selected && now !== null ? now - Date.parse(selected.at) : Infinity;
  const usable = selected && Number.isFinite(age) && age >= 0;
  const fresh = Boolean(usable && age < 10_000 && status === "live");
  const timestamp = usable ? new Date(selected.at).toISOString().slice(11, 19) : null;

  return (
    <section className={styles.scene} aria-label="Scene footage">
      <header className={styles.cardHeader}>
        <h2>
          <Camera size={16} aria-hidden="true" /> Scene footage
        </h2>
        <span className={styles.sourceState}>
          <Radio size={12} aria-hidden="true" />
          {status === "offline"
            ? "Feed offline"
            : status === "connecting"
              ? "Connecting"
              : "Frame relay"}
        </span>
      </header>
      <div className={styles.cameraPicker}>
        <label htmlFor={sourceId}>Camera source</label>
        <select
          id={sourceId}
          value={selectedSource}
          onChange={(event) => {
            setChosen(event.target.value);
            setReviewing(false);
          }}
        >
          {!selected && <option value={selectedSource}>{selectedSource} · no current feed</option>}
          {frames.map((frame) => (
            <option key={frame.sourceId} value={frame.sourceId}>
              {frame.sourceId}
            </option>
          ))}
        </select>
        <button
          type="button"
          aria-label="Review recent scene frames"
          disabled={!selected}
          aria-expanded={reviewing}
          onClick={() => setReviewing(!reviewing)}
        >
          <History size={16} />
        </button>
      </div>
      {reviewing && selected ? (
        <div className={styles.history}>
          <p className={styles.cameraFooter}>RECENT HISTORY · recorded stills, not live</p>
          <FrameReview
            key={selectedSource}
            sourceId={selectedSource}
            onClose={() => setReviewing(false)}
          />
        </div>
      ) : usable ? (
        <SceneFrame
          key={`${selected.sourceId}:${selected.at}`}
          frame={selected}
          fresh={fresh}
          timestamp={timestamp!}
        />
      ) : (
        <div className={styles.noFootage} role="status">
          <VideoOff size={30} strokeWidth={1.3} aria-hidden="true" />
          <strong>
            {status === "offline" ? "Scene feed unavailable" : "Waiting for this camera"}
          </strong>
          <span>{selectedSource} · no footage received</span>
        </div>
      )}
      <footer className={styles.cameraFooter}>
        <span>Updating stills · not continuous video</span>
        <span>Camera selection does not identify the patient.</span>
      </footer>
    </section>
  );
}

function SceneFrame({
  frame,
  fresh,
  timestamp,
}: {
  frame: FrameSummary;
  fresh: boolean;
  timestamp: string;
}) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <figure className={styles.frame}>
      {!failed && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/api/streams/${encodeURIComponent(frame.sourceId)}/frame?live=${Date.parse(frame.at)}`}
          alt={`Published scene frame from ${frame.sourceId} at ${timestamp} UTC`}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
        />
      )}
      {(!loaded || failed) && (
        <div className={styles.noFootage}>
          <VideoOff size={28} />
          <span>{failed ? "Frame unavailable" : "Loading frame"}</span>
        </div>
      )}
      <figcaption data-current={fresh && loaded && !failed}>
        <strong>
          {failed
            ? "UNAVAILABLE"
            : !loaded
              ? "LOADING"
              : fresh
                ? "CURRENT FRAME"
                : "STALE · NOT LIVE"}
        </strong>
        <time dateTime={frame.at}>{timestamp} UTC</time>
      </figcaption>
      {frame.heard && <p className={styles.heard}>Transcript · unverified: {frame.heard}</p>}
    </figure>
  );
}
