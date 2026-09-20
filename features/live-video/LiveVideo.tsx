"use client";

import { useEffect, useRef, useState } from "react";

import { recordPlayback, removePlayback } from "./diagnostics";

/**
 * A received track, on screen.
 *
 * `srcObject` cannot be set from JSX, so the element is reached through a ref
 * rather than a prop. Sound starts only after the viewer enables listening.
 * Detaching playback never stops the transport's shared media tracks.
 */
export function LiveVideo({
  stream,
  className,
  label,
  sourceId,
  audioEnabled = false,
}: {
  stream: MediaStream;
  className?: string;
  label: string;
  sourceId?: string;
  audioEnabled?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [audioBlocked, setAudioBlocked] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.srcObject = stream;
    const attachedAt = performance.now();
    let firstFrameMs: number | undefined;
    let lastReported = -Infinity;
    let callback: number | undefined;
    let cancelled = false;
    if (sourceId && typeof video.requestVideoFrameCallback === "function") {
      const frame = (
        now: number,
        metadata: VideoFrameCallbackMetadata & { captureTime?: number; receiveTime?: number },
      ) => {
        if (cancelled) return;
        firstFrameMs ??= now - attachedAt;
        if (now - lastReported >= 1_000) {
          const age =
            metadata.captureTime === undefined
              ? undefined
              : metadata.expectedDisplayTime - metadata.captureTime;
          const delay =
            metadata.receiveTime === undefined
              ? undefined
              : metadata.expectedDisplayTime - metadata.receiveTime;
          recordPlayback({
            sourceId,
            streamId: stream.id,
            firstFrameMs,
            lastFrameAt: now,
            frameAgeMs: age !== undefined && Number.isFinite(age) && age >= 0 ? age : undefined,
            renderDelayMs:
              delay !== undefined && Number.isFinite(delay) && delay >= 0 ? delay : undefined,
          });
          lastReported = now;
        }
        callback = video.requestVideoFrameCallback(frame);
      };
      callback = video.requestVideoFrameCallback(frame);
    }
    return () => {
      cancelled = true;
      if (callback !== undefined) video.cancelVideoFrameCallback(callback);
      if (sourceId) removePlayback(stream.id);
      video.srcObject = null;
    };
  }, [stream, sourceId]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let cancelled = false;
    const play = () => {
      video.muted = !audioEnabled;
      void video
        .play()
        .then(() => {
          if (!cancelled) setAudioBlocked(false);
        })
        .catch(() => {
          if (cancelled) return;
          if (audioEnabled) {
            setAudioBlocked(true);
            // Preserve the picture if the browser refuses audible autoplay.
            video.muted = true;
            void video.play().catch(() => undefined);
          }
        });
    };
    play();
    stream.addEventListener("addtrack", play);
    return () => {
      cancelled = true;
      stream.removeEventListener("addtrack", play);
    };
  }, [stream, audioEnabled]);

  return (
    <>
      <video
        ref={videoRef}
        className={className}
        aria-label={label}
        playsInline
        muted={!audioEnabled}
        autoPlay
      />
      {audioEnabled && audioBlocked && (
        <span role="status">Audio playback was blocked. Turn listening off and on to retry.</span>
      )}
    </>
  );
}
