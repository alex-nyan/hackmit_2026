"use client";

import { useEffect, useState, type ReactNode } from "react";

import { LiveVideo } from "./LiveVideo";
import { useLiveWatcher, type WatchState } from "./useLiveWatcher";

interface LiveTileProps {
  sourceId: string;
  /** The latest published frame, shown whenever there is no direct link. */
  fallbackSrc?: string;
  fallback?: ReactNode;
  /** Enabled by an explicit viewer interaction, never autoplayed with sound. */
  audioEnabled?: boolean;
  alt: string;
  className?: string;
  /**
   * Told which of the two this is, so the caller can label it in its own
   * words. A tile that says LIVE while showing a two-second-old still would
   * be the one lie this whole wall is built to avoid.
   */
  onLiveChange?: (live: boolean) => void;
  /** Lets the surrounding tile distinguish a live stream from its still fallback. */
  onStateChange?: (state: WatchState) => void;
}

/**
 * One camera, as video if the browsers found each other and as the last
 * published still if they did not.
 *
 * The fallback is not a placeholder to be deleted once this works. A direct
 * link fails for ordinary reasons — a network that isolates its clients, a
 * camera already serving its limit of watchers, an officer on a page that
 * does not publish video — and on every one of them the wall should keep
 * showing what it can rather than go dark.
 */
export function LiveTile({
  sourceId,
  fallbackSrc,
  fallback,
  audioEnabled = false,
  alt,
  className,
  onLiveChange,
  onStateChange,
}: LiveTileProps) {
  const { stream, state } = useLiveWatcher(sourceId);
  const live = stream !== null && state === "live";

  useEffect(() => {
    onLiveChange?.(live);
  }, [live, onLiveChange]);

  useEffect(() => {
    onStateChange?.(state);
  }, [onStateChange, state]);

  if (stream && live)
    return (
      <LiveVideo
        stream={stream}
        sourceId={sourceId}
        className={className}
        label={alt}
        audioEnabled={audioEnabled}
      />
    );

  const waiting = fallback ?? (
    <span className={className} role="status">
      {state === "connecting"
        ? "Connecting to camera…"
        : state === "stalled"
          ? "Video interrupted. Reconnecting…"
          : "Waiting for live camera"}
    </span>
  );
  if (!fallbackSrc) return waiting;

  return (
    <Snapshot
      key={fallbackSrc}
      src={fallbackSrc}
      alt={alt}
      className={className}
      fallback={waiting}
    />
  );
}

function Snapshot({
  src,
  alt,
  className,
  fallback,
}: {
  src: string;
  alt: string;
  className?: string;
  fallback: ReactNode;
}) {
  const [failed, setFailed] = useState(false);
  if (failed) return fallback;

  // eslint-disable-next-line @next/next/no-img-element
  return <img className={className} src={src} alt={alt} onError={() => setFailed(true)} />;
}
