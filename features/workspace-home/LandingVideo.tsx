"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { ArrowUpRight, Play } from "lucide-react";
import { BrandLogo } from "@/components/BrandLogo";
import styles from "./LandingVideo.module.css";

const VIDEO_ID = "mQsPtt9D8dA";
const WATCH_URL = `https://www.youtube.com/watch?v=${VIDEO_ID}`;
const EMBED_URL = `https://www.youtube-nocookie.com/embed/${VIDEO_ID}?autoplay=1&playsinline=1&controls=1&rel=0`;

export function LandingVideo({ className }: { className?: string } = {}) {
  const [activated, setActivated] = useState(false);
  const [thumbnailFailed, setThumbnailFailed] = useState(false);
  const player = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (activated) player.current?.focus();
  }, [activated]);

  return (
    <div className={[styles.video, className].filter(Boolean).join(" ")}>
      {activated ? (
        <>
          <iframe
            ref={player}
            className={styles.player}
            src={EMBED_URL}
            title="Paw Patrol — Problem understanding showcase"
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
          />
          <a
            className={styles.external}
            href={WATCH_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Watch the film on YouTube in a new tab"
          >
            Watch on YouTube <ArrowUpRight size={13} aria-hidden="true" />
          </a>
        </>
      ) : (
        <button
          type="button"
          className={styles.poster}
          onClick={() => setActivated(true)}
          aria-label="Play the film"
        >
          <span className={styles.fallback} aria-hidden="true">
            <BrandLogo size={88} />
          </span>
          {!thumbnailFailed && (
            <Image
              className={styles.thumbnail}
              src={`https://i.ytimg.com/vi/${VIDEO_ID}/maxresdefault.jpg`}
              alt=""
              fill
              sizes="(max-width: 1200px) 90vw, 1100px"
              unoptimized
              onError={() => setThumbnailFailed(true)}
              onLoad={(event) => {
                if (event.currentTarget.naturalWidth <= 120) setThumbnailFailed(true);
              }}
            />
          )}
          <span className={styles.shade} aria-hidden="true" />
          <span className={styles.playLabel}>
            <span className={styles.playIcon}>
              <Play size={27} fill="currentColor" aria-hidden="true" />
            </span>
            <span>Watch the film</span>
          </span>
        </button>
      )}
    </div>
  );
}
