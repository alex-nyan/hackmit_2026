"use client";

import { useEffect, useRef, useState } from "react";

import type { LiveTrackPayload, LiveTrackState } from "./types";

const POLL_INTERVAL_MS = 5000;

/**
 * Polls the server route while tracking is switched on. Only the latest fix is
 * held; no location history is retained in the browser. Turning tracking off
 * aborts the in-flight request and drops the fix.
 */
export function useLiveTrack(enabled: boolean): LiveTrackState {
  const [payload, setPayload] = useState<LiveTrackPayload | null>(null);
  const [lastEnabled, setLastEnabled] = useState(enabled);
  const abortRef = useRef<AbortController | null>(null);

  // Toggling clears the previous answer during render, so a re-enabled panel
  // never shows the fix from the last session before the first poll returns.
  if (lastEnabled !== enabled) {
    setLastEnabled(enabled);
    setPayload(null);
  }

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function poll() {
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const response = await fetch("/api/live-position", {
          signal: controller.signal,
          cache: "no-store",
        });
        const next = (await response.json()) as LiveTrackPayload;
        if (!cancelled) setPayload(next);
      } catch {
        if (!cancelled) {
          setPayload({
            state: "unavailable",
            reason: "The dashboard could not reach its tracking route.",
          });
        }
      } finally {
        if (!cancelled) timer = setTimeout(poll, POLL_INTERVAL_MS);
      }
    }

    void poll();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, [enabled]);

  if (!enabled) return { state: "idle" };
  return payload ?? { state: "connecting" };
}
