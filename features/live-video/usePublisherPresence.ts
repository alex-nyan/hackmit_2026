"use client";

import { useEffect } from "react";

import { PUBLISHER_HEARTBEAT_MS } from "./presence";

const REQUEST_TIMEOUT_MS = 6_000;

/** An independent camera lease: slow snapshots and inference cannot stop it. */
export function usePublisherPresence(sourceId: string, stream: MediaStream | null): void {
  useEffect(() => {
    if (!sourceId || !stream) return;
    const tracks = stream.getVideoTracks();
    if (!tracks.some((track) => track.readyState === "live")) return;

    const endpoint = `/api/webrtc/${encodeURIComponent(sourceId)}/presence`;
    let sessionId = crypto.randomUUID().replaceAll("-", "");
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;

    async function heartbeat() {
      if (stopped) return;
      if (!tracks.some((track) => track.readyState === "live")) {
        stop();
        return;
      }
      const request = new AbortController();
      const requestSession = sessionId;
      controller = request;
      const timeout = setTimeout(() => request.abort(), REQUEST_TIMEOUT_MS);
      try {
        await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId, active: true }),
          signal: request.signal,
          cache: "no-store",
        });
      } catch {
        // Existing media stays connected while discovery retries independently.
      } finally {
        clearTimeout(timeout);
        if (controller === request) controller = undefined;
        if (!stopped && sessionId === requestSession) {
          timer = setTimeout(() => void heartbeat(), PUBLISHER_HEARTBEAT_MS);
        }
      }
    }

    function stop() {
      if (stopped) return;
      stopped = true;
      if (timer) clearTimeout(timer);
      controller?.abort();
      const body = JSON.stringify({ sessionId, active: false });
      const queued = navigator.sendBeacon?.(
        endpoint,
        new Blob([body], { type: "application/json" }),
      );
      if (!queued) {
        void fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
          keepalive: true,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        }).catch(() => undefined);
      }
    }

    function resume(event: PageTransitionEvent) {
      if (!event.persisted || !stopped || !tracks.some((track) => track.readyState === "live"))
        return;
      sessionId = crypto.randomUUID().replaceAll("-", "");
      stopped = false;
      void heartbeat();
    }

    function ended() {
      if (!tracks.some((track) => track.readyState === "live")) stop();
    }

    tracks.forEach((track) => track.addEventListener("ended", ended));
    window.addEventListener("pagehide", stop);
    window.addEventListener("pageshow", resume);
    void heartbeat();
    return () => {
      stop();
      tracks.forEach((track) => track.removeEventListener("ended", ended));
      window.removeEventListener("pagehide", stop);
      window.removeEventListener("pageshow", resume);
    };
  }, [sourceId, stream]);
}
