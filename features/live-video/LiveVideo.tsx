"use client";

import { useEffect, useRef } from "react";

/**
 * A received track, on screen.
 *
 * `srcObject` cannot be set from JSX, so the element is reached through a ref
 * rather than a prop. Muted and inline because autoplay is refused otherwise,
 * and a wall of cameras that all start talking at once is nobody's idea of a
 * dispatch console — this carries video only, and the audio pipeline stays
 * where it was.
 */
export function LiveVideo({
  stream,
  className,
  label,
}: {
  stream: MediaStream;
  className?: string;
  label: string;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.srcObject = stream;
    void video.play().catch(() => undefined);
    return () => {
      video.srcObject = null;
    };
  }, [stream]);

  return (
    <video ref={videoRef} className={className} aria-label={label} playsInline muted autoPlay />
  );
}
