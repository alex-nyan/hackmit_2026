"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { IncidentDraft, IncidentEvent } from "./incidents";

const ENDPOINT = "/api/incidents";

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

  useEffect(() => {
    if (typeof EventSource === "undefined") {
      // No subscription is possible here. Reported after commit rather than in
      // the effect body: setting it synchronously would cascade a render, and
      // deciding during render would disagree with the server, where
      // EventSource is always absent.
      const timer = setTimeout(() => setStatus("offline"), 0);
      return () => clearTimeout(timer);
    }

    const source = new EventSource(ENDPOINT);

    source.addEventListener("open", () => setStatus("live"));

    source.addEventListener("incident", (message) => {
      const payload = (message as MessageEvent<string>).data;
      let event: IncidentEvent;
      try {
        event = JSON.parse(payload) as IncidentEvent;
      } catch {
        return;
      }
      if (typeof event?.seq !== "number") return;
      // A reconnect can replay an event this workspace already rendered.
      if (seenRef.current.has(event.seq)) return;
      seenRef.current.add(event.seq);
      setEvents((current) => [...current, event]);
    });

    source.addEventListener("reset", () => {
      seenRef.current.clear();
      setEvents([]);
    });

    source.addEventListener("error", () => {
      // EventSource retries by itself; report the gap while it is open.
      setStatus(source.readyState === EventSource.CLOSED ? "offline" : "connecting");
    });

    return () => source.close();
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
    setEvents([]);
  }, []);

  return { events, status, publish, clear };
}
