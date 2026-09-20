"use client";

import { useEffect, useId, useState, type SyntheticEvent } from "react";
import { Camera, History, Radio, VideoOff } from "lucide-react";
import { useBodyCamWall } from "../body-cam/useBodyCamWall";
import { FrameReview } from "../body-cam/FrameReview";
import type { FrameSummary } from "../body-cam/frames";
import { isValidToken } from "../camera-triage/frame";
import { bodySourceIds } from "../anatomy/bodyEvidence";
import { LiveTile, type WatchState } from "../live-video";
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
  const [linkedSource, setLinkedSource] = useState<string | null>(null);
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
  const candidates = bodySourceIds(personId);
  const availableSource = candidates.find((candidate) =>
    frames.some((frame) => frame.sourceId === candidate),
  );
  useEffect(() => {
    // Resolve only an existing known unit-slot alias, then keep that choice even
    // if it disappears. Do not switch a medic to another source on a later poll.
    if (!availableSource || linkedSource !== null || chosen !== null) return;
    const frame = requestAnimationFrame(() => setLinkedSource(availableSource));
    return () => cancelAnimationFrame(frame);
  }, [availableSource, linkedSource, chosen]);
  // Source labels do not independently establish the person being filmed.
  const selectedSource = chosen ?? linkedSource ?? candidates[0];
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
            ? "Frame relay offline"
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
          {!selected && <option value={selectedSource}>{selectedSource} · no current still</option>}
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
      ) : (
        <SceneMedia
          key={selectedSource}
          sourceId={selectedSource}
          frame={usable ? selected : null}
          fresh={fresh}
          timestamp={timestamp}
        />
      )}
      <footer className={styles.cameraFooter}>
        <span>LIVE = direct video · otherwise a labelled still</span>
        <span>Camera selection does not identify the patient.</span>
      </footer>
    </section>
  );
}

function SceneMedia({
  sourceId,
  frame,
  fresh,
  timestamp,
}: {
  sourceId: string;
  frame: FrameSummary | null;
  fresh: boolean;
  timestamp: string | null;
}) {
  const [live, setLive] = useState(false);
  const [streamState, setStreamState] = useState<WatchState>("idle");
  const [frameState, setFrameState] = useState<{ at: string; state: "loaded" | "failed" } | null>(
    null,
  );
  const loaded = Boolean(frame && frameState?.at === frame.at && frameState.state === "loaded");
  const failed = Boolean(frame && frameState?.at === frame.at && frameState.state === "failed");
  function recordFrame(event: SyntheticEvent, state: "loaded" | "failed") {
    const target = event.target;
    if (!(target instanceof HTMLImageElement) || !frame) return;
    // A late load/error from a superseded request must not label the new still.
    const requestTime = new URL(target.currentSrc || target.src).searchParams.get("live");
    if (requestTime !== String(Date.parse(frame.at))) return;
    setFrameState({ at: frame.at, state });
  }
  return (
    <figure className={styles.frame}>
      <div
        hidden={!live && failed}
        onLoadCapture={(event) => recordFrame(event, "loaded")}
        onErrorCapture={(event) => recordFrame(event, "failed")}
      >
        <LiveTile
          sourceId={sourceId}
          onLiveChange={setLive}
          onStateChange={setStreamState}
          fallbackSrc={
            frame
              ? `/api/streams/${encodeURIComponent(sourceId)}/frame?live=${Date.parse(frame.at)}`
              : undefined
          }
          alt={
            live
              ? `Live scene camera from ${sourceId}`
              : `Published scene still from ${sourceId} at ${timestamp ?? "unknown time"} UTC`
          }
        />
      </div>
      {!live && frame && (!loaded || failed) && (
        <div className={styles.noFootage}>
          <VideoOff size={28} />
          <span>{failed ? "Frame unavailable" : "Loading frame"}</span>
        </div>
      )}
      <figcaption data-current={live || (fresh && loaded && !failed)}>
        <strong>
          {live
            ? "LIVE VIDEO"
            : failed
              ? "UNAVAILABLE"
              : !frame
                ? streamState === "connecting"
                  ? "CONNECTING · NO STILL"
                  : "NO RECEIVED FOOTAGE"
                : !loaded
                  ? "LOADING"
                  : fresh
                    ? "CURRENT STILL · NOT LIVE"
                    : "STALE STILL · NOT LIVE"}
        </strong>
        {live ? (
          <span>{sourceId} · direct stream</span>
        ) : (
          frame && <time dateTime={frame.at}>{timestamp} UTC</time>
        )}
      </figcaption>
      {frame?.heard && <p className={styles.heard}>Transcript · unverified: {frame.heard}</p>}
    </figure>
  );
}
