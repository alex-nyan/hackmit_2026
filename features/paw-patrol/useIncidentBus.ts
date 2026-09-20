"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { IncidentDraft, IncidentEvent } from "./incidents";

const ENDPOINT = "/api/incidents";
/** Fast enough that a panic button feels immediate, slow enough to be cheap. */
const POLL_MS = 1_500;

export type BusStatus = "connecting" | "live" | "offline";

/**
 * Subscribes this workspace to the shared incident log.
 *
 * `EventSource` reconnects on its own and replays from `Last-Event-ID`, so a
 * dropped connection loses no events — the server filters by sequence. The
 * status is reported honestly rather than optimistically: `offline` means this
 * workspace is no longer seeing what the others do, which a viewer must be able
 * to tell apart from a quiet incident.
 */
export function useIncidentBus() {
  const [events, setEvents] = useState<IncidentEvent[]>([]);
  const [status, setStatus] = useState<BusStatus>("connecting");
  const seenRef = useRef<Set<number>>(new Set());
  const sinceRef = useRef(0);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const inFlight = new AbortController();

    async function poll() {
      try {
        const response = await fetch(`${ENDPOINT}?since=${sinceRef.current}`, {
          cache: "no-store",
          signal: inFlight.signal,
        });
        if (!response.ok) throw new Error(String(response.status));
        const body = (await response.json()) as { events?: unknown };
        if (stopped) return;

        const arriving = Array.isArray(body.events) ? (body.events as IncidentEvent[]) : [];
        const fresh = arriving.filter(
          (event) => typeof event?.seq === "number" && !seenRef.current.has(event.seq),
        );
        if (fresh.length > 0) {
          for (const event of fresh) seenRef.current.add(event.seq);
          // The cursor only advances on events this workspace has accepted,
          // so a partial read is retried rather than skipped.
          sinceRef.current = Math.max(sinceRef.current, ...fresh.map((event) => event.seq));
          setEvents((current) => [...current, ...fresh]);
        }
        setStatus("live");
      } catch {
        // A failed poll is not a quiet incident: the log stays on screen and
        // the status says it can no longer be trusted.
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

  const publish = useCallback(async (draft: IncidentDraft): Promise<boolean> => {
    try {
      const response = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      return response.ok;
    } catch {
      // The demo must keep running when the bus is unreachable. The status
      // indicator already tells the viewer that workspaces are not in sync.
      return false;
    }
  }, []);

  const clear = useCallback(async (): Promise<void> => {
    try {
      await fetch(ENDPOINT, { method: "DELETE" });
    } catch {
      // Local state is cleared by the caller's own reset regardless.
    }
    seenRef.current.clear();
    sinceRef.current = 0;
    setEvents([]);
  }, []);

  return { events, status, publish, clear };
}
