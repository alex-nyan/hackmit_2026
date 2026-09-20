"use client";

import { useEffect } from "react";

import { LiveVideo } from "./LiveVideo";
import { useLiveWatcher, type WatchState } from "./useLiveWatcher";

interface LiveTileProps {
  sourceId: string;
  /** The latest published frame, shown whenever there is no direct link. */
  fallbackSrc?: string;
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
  alt,
  className,
  onLiveChange,
  onStateChange,
}: LiveTileProps) {
  const { stream, state } = useLiveWatcher(sourceId);
  const live = stream !== null;

  useEffect(() => {
    onLiveChange?.(live);
  }, [live, onLiveChange]);

  useEffect(() => {
    onStateChange?.(state);
  }, [onStateChange, state]);

  if (stream) return <LiveVideo stream={stream} className={className} label={alt} />;

  if (!fallbackSrc)
    return (
      <p role="status">
        {state === "unavailable"
          ? "Live camera is unavailable. Retrying the connection…"
          : "Connecting to this officer’s live camera…"}
      </p>
    );

  // eslint-disable-next-line @next/next/no-img-element
  return <img className={className} src={fallbackSrc} alt={alt} />;
}
