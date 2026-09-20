"use client";

import { useEffect, useState } from "react";

import type { FrameSummary } from "./frames";

const ENDPOINT = "/api/streams";
/** Officers publish about every two seconds; polling faster only costs requests. */
const POLL_MS = 1_500;

export type WallStatus = "connecting" | "live" | "offline";

/**
 * Subscribes this workspace to every officer publishing frames.
 *
 * Polling rather than an event stream: the wall holds only the latest frame
 * per officer, so there is no backlog a reconnecting watcher could miss, and
 * a poll does not hold a server instance open for every person watching.
 *
 * Status is reported honestly rather than optimistically — `offline` means
 * this workspace has stopped seeing what the others see, which a viewer must
 * be able to tell apart from a scene where nothing is happening.
 */
export function useBodyCamWall() {
  const [frames, setFrames] = useState<FrameSummary[]>([]);
  const [status, setStatus] = useState<WallStatus>("connecting");

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const inFlight = new AbortController();

    async function poll() {
      try {
        const response = await fetch(ENDPOINT, {
          cache: "no-store",
          signal: inFlight.signal,
        });
        if (!response.ok) throw new Error(String(response.status));
        const body = (await response.json()) as { frames?: unknown };
        if (stopped) return;
        setFrames(Array.isArray(body.frames) ? (body.frames as FrameSummary[]) : []);
        setStatus("live");
      } catch {
        // A failed poll is not an empty wall: the last roster stays on screen
        // and the status says it can no longer be trusted.
        if (!stopped) setStatus("offline");
      } finally {
        if (!stopped) timer = setTimeout(() => void poll(), POLL_MS);
      }
    }

    void poll();

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      inFlight.abort();
    };
  }, []);

  return { frames, status };
}
