"use client";

import { useEffect, useState } from "react";

/** Refreshed while the reviewer is looking, so a live officer keeps growing. */
const REFRESH_MS = 5_000;

export type HistoryStatus = "loading" | "ready" | "unavailable";

/**
 * The moments one officer published, for the review scrubber.
 *
 * Timestamps only. The images are fetched one at a time as the scrubber
 * lands on them, so opening review costs a listing rather than an archive.
 */
export function useFrameHistory(sourceId: string) {
  const [frames, setFrames] = useState<number[]>([]);
  const [status, setStatus] = useState<HistoryStatus>("loading");

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const inFlight = new AbortController();

    async function load() {
      try {
        const response = await fetch(`/api/streams/${encodeURIComponent(sourceId)}/history`, {
          cache: "no-store",
          signal: AbortSignal.any([inFlight.signal, AbortSignal.timeout(10_000)]),
        });
        if (!response.ok) throw new Error(String(response.status));
        const body = (await response.json()) as { frames?: unknown };
        if (stopped) return;
        setFrames(Array.isArray(body.frames) ? (body.frames as number[]) : []);
        setStatus("ready");
      } catch {
        if (!stopped) setStatus("unavailable");
      } finally {
        if (!stopped) timer = setTimeout(() => void load(), REFRESH_MS);
      }
    }

    void load();

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      inFlight.abort();
    };
  }, [sourceId]);

  return { frames, status };
}
