"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { parseIncidentDraft, type IncidentDraft, type IncidentEvent } from "./incidents";

const ENDPOINT = "/api/incidents";
/** Fast enough that a panic button feels immediate, slow enough to be cheap. */
const POLL_MS = 1_500;
/** The shared store retains this bounded snapshot, not an unbounded client backlog. */
const MAX_RETAINED = 200;

function parseSnapshot(value: unknown): IncidentEvent[] | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (
    !Array.isArray(body.events) ||
    body.events.length > MAX_RETAINED ||
    typeof body.seq !== "number" ||
    !Number.isSafeInteger(body.seq) ||
    body.seq < 0
  )
    return null;
  const events: IncidentEvent[] = [];
  let previousSequence = 0;
  for (const item of body.events) {
    const draft = parseIncidentDraft(item);
    if (!draft || !item || typeof item !== "object" || Array.isArray(item)) return null;
    const raw = item as Record<string, unknown>;
    if (
      typeof raw.seq !== "number" ||
      !Number.isSafeInteger(raw.seq) ||
      raw.seq <= previousSequence ||
      typeof raw.at !== "string" ||
      raw.at.length > 40 ||
      !Number.isFinite(Date.parse(raw.at))
    )
      return null;
    events.push({ ...draft, seq: raw.seq, at: raw.at });
    previousSequence = raw.seq;
  }
  return body.seq === previousSequence ? events : null;
}

export type BusStatus = "connecting" | "live" | "offline";

/**
 * Subscribes this workspace to the shared incident log.
 *
 * Poll the full bounded snapshot: server sequence numbers restart after a demo
 * reset, so a remembered cursor can otherwise hide every event in the new run.
 * Failed or malformed reads retain the last accepted snapshot with an offline
 * status, never an empty log that looks like a quiet incident.
 */
export function useIncidentBus() {
  const [events, setEvents] = useState<IncidentEvent[]>([]);
  const [status, setStatus] = useState<BusStatus>("connecting");
  const snapshotSignature = useRef("");
  const resetGeneration = useRef(0);
  const clearing = useRef(false);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const inFlight = new AbortController();

    async function poll() {
      const generation = resetGeneration.current;
      try {
        if (clearing.current) return;
        const response = await fetch(`${ENDPOINT}?since=0`, {
          cache: "no-store",
          signal: AbortSignal.any([inFlight.signal, AbortSignal.timeout(10_000)]),
        });
        if (!response.ok) throw new Error(String(response.status));
        const arriving = parseSnapshot(await response.json());
        if (!arriving) throw new Error("Invalid incident snapshot");
        if (stopped || generation !== resetGeneration.current || clearing.current) return;
        const signature = JSON.stringify(arriving);
        if (signature !== snapshotSignature.current) {
          snapshotSignature.current = signature;
          setEvents(arriving);
        }
        setStatus("live");
      } catch {
        // A failed poll is not a quiet incident: the log stays on screen and
        // the status says it can no longer be trusted.
        if (!stopped && generation === resetGeneration.current && !clearing.current)
          setStatus("offline");
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
    if (clearing.current) return;
    clearing.current = true;
    resetGeneration.current += 1;
    try {
      const response = await fetch(ENDPOINT, {
        method: "DELETE",
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error("Incident reset was not confirmed");
      snapshotSignature.current = "[]";
      setEvents([]);
      setStatus("live");
    } catch {
      // Keep the last accepted shared log until the server confirms its removal.
      setStatus("offline");
    } finally {
      resetGeneration.current += 1;
      clearing.current = false;
    }
  }, []);

  return { events, status, publish, clear };
}
