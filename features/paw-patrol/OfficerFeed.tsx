"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Camera } from "lucide-react";
import styles from "./HospitalWorkspace.module.css";

/** A receiving adapter supplies the selected officer's remote stream (e.g. WebRTC).
 * The adapter owns the stream; this view neither captures nor stops its tracks. */
export interface OfficerMediaInput {
  personId: string;
  stream: MediaStream;
}

export function OfficerFeed({
  personId,
  input,
}: {
  personId: string;
  input?: OfficerMediaInput | null;
}) {
  const stream = input?.personId === personId ? input.stream : null;
  return <MediaPlayer key={`${personId}-${stream?.id ?? "offline"}`} stream={stream} />;
}

function MediaPlayer({ stream }: { stream: MediaStream | null }) {
  const video = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [issue, setIssue] = useState("");
  const subscribe = useCallback(
    (notify: () => void) => {
      if (!stream) return () => {};
      const tracks = new Set<MediaStreamTrack>();
      function watchTracks() {
        for (const track of stream!.getTracks()) {
          if (tracks.has(track)) continue;
          tracks.add(track);
          for (const event of ["ended", "mute", "unmute"]) track.addEventListener(event, notify);
        }
        notify();
      }
      watchTracks();
      stream.addEventListener("addtrack", watchTracks);
      stream.addEventListener("removetrack", notify);
      return () => {
        stream.removeEventListener("addtrack", watchTracks);
        stream.removeEventListener("removetrack", notify);
        for (const track of tracks) {
          for (const event of ["ended", "mute", "unmute"]) track.removeEventListener(event, notify);
        }
      };
    },
    [stream],
  );
  const snapshot = useCallback(() => {
    const available = (kind: string) =>
      stream
        ?.getTracks()
        .some(
          (track) =>
            track.kind === kind && track.readyState === "live" && !track.muted && track.enabled,
        );
    return (available("video") ? 1 : 0) | (available("audio") ? 2 : 0);
  }, [stream]);
  const tracks = useSyncExternalStore(subscribe, snapshot, () => 0);
  const hasVideo = Boolean(tracks & 1);
  const hasAudio = Boolean(tracks & 2);
  const current = playing && hasVideo && !issue;

  useEffect(() => {
    const element = video.current;
    if (!element) return;
    element.srcObject = stream;
    return () => {
      element.srcObject = null;
    };
  }, [stream]);

  async function startPlayback() {
    const element = video.current;
    if (!element) return;
    element.muted = false;
    try {
      await element.play();
      setIssue("");
    } catch {
      setIssue("Playback paused. Try again.");
    }
  }

  return (
    <>
      <div className={styles.panelHeading}>
        <h2>
          <Camera size={19} aria-hidden="true" /> Officer camera
        </h2>
        <span className={styles.feedStatus} data-live={current} role="status">
          <i aria-hidden="true" />
          {current ? "Live" : stream ? "Waiting for video" : "Not connected"}
        </span>
      </div>
      <div className={styles.videoStage}>
        <video
          ref={video}
          className={current ? styles.video : styles.videoHidden}
          aria-label="Officer camera feed"
          autoPlay
          playsInline
          onPlaying={() => {
            setPlaying(true);
            setIssue("");
          }}
          onWaiting={() => setPlaying(false)}
          onStalled={() => setPlaying(false)}
          onPause={() => setPlaying(false)}
          onEnded={() => {
            setPlaying(false);
          }}
          onError={() => {
            setPlaying(false);
            setIssue("Camera feed unavailable");
          }}
        />
        {!current && (
          <div className={styles.videoEmpty}>
            <Camera size={42} strokeWidth={1.25} aria-hidden="true" />
            <p>{issue || "Waiting for officer camera"}</p>
            {(hasVideo || hasAudio) && !playing && (
              <button type="button" onClick={() => void startPlayback()}>
                Play feed
              </button>
            )}
          </div>
        )}
      </div>
    </>
  );
}
