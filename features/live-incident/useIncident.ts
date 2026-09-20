"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  parseCommandReceipt,
  parseIncidentEvent,
  parseIncidentSnapshot,
  type IncidentCommand,
  type IncidentSnapshot,
} from "../../shared/contracts";

export type Connection = "connecting" | "connected" | "disconnected" | "unauthorized";

export function useIncident(incidentId: string | null) {
  const [snapshot, setSnapshot] = useState<IncidentSnapshot | null>(null);
  const [connection, setConnection] = useState<Connection>("connecting");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [receivedAt, setReceivedAt] = useState(0);
  const refreshRef = useRef<() => Promise<void>>(async () => {});
  const activeId = useRef(incidentId);
  const commandBusy = useRef(false);
  const retries = useRef(new Map<string, { key: string; body: string }>());

  useEffect(() => {
    activeId.current = incidentId;
    if (!incidentId) return;
    let closed = false;
    let stream: EventSource | null = null;
    let loading: Promise<void> | null = null;
    let refreshAgain = false;
    let streamOpen = false;
    let connecting = false;
    let unauthorized = false;
    let revision = -1;
    const abort = new AbortController();
    const path = `/api/live/incidents/${encodeURIComponent(incidentId)}`;
    async function refresh() {
      if (closed || unauthorized) return;
      if (loading) {
        refreshAgain = true;
        return loading;
      }
      loading = (async () => {
        try {
          const response = await fetch(`${path}/state`, {
            cache: "no-store",
            signal: AbortSignal.any([abort.signal, AbortSignal.timeout(10_000)]),
          });
          if (response.status === 401 || response.status === 403) {
            unauthorized = true;
            streamOpen = false;
            if (!closed) {
              setConnection("unauthorized");
              setSnapshot(null);
              setError("Access unavailable. Sign in again with an authorized operator credential.");
            }
            stream?.close();
            return;
          }
          if (!response.ok) throw new Error("Incident service unavailable.");
          const next = parseIncidentSnapshot(await response.json());
          if (next.incident_id !== incidentId)
            throw new Error("Incident response did not match the request.");
          if (!closed && next.revision >= revision) {
            revision = next.revision;
            setSnapshot(next);
            setReceivedAt(Date.now());
            setError("");
            if (streamOpen) setConnection("connected");
          }
        } catch {
          if (!closed) {
            setConnection("disconnected");
            setError("Live updates unavailable. Displayed observations may be stale.");
          }
        } finally {
          loading = null;
        }
      })();
      await loading;
      if (refreshAgain && !closed) {
        refreshAgain = false;
        await refresh();
      }
    }
    refreshRef.current = refresh;
    const connect = async () => {
      if (closed || connecting || unauthorized) return;
      connecting = true;
      await refresh();
      connecting = false;
      if (closed || revision < 0 || unauthorized) return;
      stream = new EventSource(`${path}/events?after=${revision}`);
      stream.onopen = () => {
        if (!closed) {
          streamOpen = true;
          void refresh();
        }
      };
      stream.onerror = () => {
        streamOpen = false;
        if (!closed) setConnection("disconnected");
      };
      const event = (raw: MessageEvent) => {
        try {
          const next = parseIncidentEvent(JSON.parse(raw.data));
          if (next.incident_id !== incidentId) throw new Error("incident mismatch");
          if (next.revision > revision) void refresh();
        } catch {
          if (!closed) {
            setConnection("disconnected");
            setError("Invalid incident update rejected.");
          }
        }
      };
      stream.onmessage = event;
      stream.addEventListener("incident", event);
      stream.addEventListener("resync_required", () => {
        streamOpen = false;
        stream?.close();
        stream = null;
        void connect();
      });
      stream.addEventListener("unavailable", () => {
        streamOpen = false;
        stream?.close();
        stream = null;
        if (!closed) setConnection("disconnected");
      });
    };
    void connect();
    // Recheck source freshness and access even in the absence of new events.
    const timer = setInterval(() => {
      if (!stream) void connect();
      else void refresh();
    }, 5_000);
    return () => {
      closed = true;
      activeId.current = null;
      abort.abort();
      stream?.close();
      clearInterval(timer);
    };
  }, [incidentId]);

  const command = useCallback(
    async (value: IncidentCommand) => {
      if (!incidentId || commandBusy.current) return false;
      // Snapshot revisions change during network uncertainty. The same operator
      // intent must replay its original body/revision and key, so a committed
      // command is found by server idempotency before optimistic concurrency.
      const intent = Object.fromEntries(
        Object.entries(value)
          .filter(([field]) => field !== "expected_revision")
          .sort(([left], [right]) => left.localeCompare(right)),
      );
      const retryId = `${incidentId}:${JSON.stringify(intent)}`;
      if (!retries.current.has(retryId) && retries.current.size >= 32) {
        setError(
          "Too many actions have unknown outcomes. Reconcile pending requests before submitting another action.",
        );
        return false;
      }
      commandBusy.current = true;
      setPending(true);
      setError("");
      const request = retries.current.get(retryId) ?? {
        key: crypto.randomUUID(),
        body: JSON.stringify(value),
      };
      retries.current.set(retryId, request);
      try {
        const response = await fetch(
          `/api/live/incidents/${encodeURIComponent(incidentId)}/commands`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json", "Idempotency-Key": request.key },
            body: request.body,
            signal: AbortSignal.timeout(15_000),
          },
        );
        if (activeId.current !== incidentId) return false;
        if (response.status >= 400 && response.status < 500) retries.current.delete(retryId);
        if (response.status === 409) {
          await refreshRef.current();
          throw new Error("The incident changed. Review the current state before trying again.");
        }
        if (!response.ok)
          throw new Error(
            "Action was not confirmed by the server. Retry the same action to reuse its request ID.",
          );
        const receipt = parseCommandReceipt(await response.json());
        if (receipt.incident_id !== incidentId)
          throw new Error("Action confirmation did not match this incident.");
        retries.current.delete(retryId);
        await refreshRef.current();
        return true;
      } catch (issue) {
        if (activeId.current === incidentId)
          setError(issue instanceof Error ? issue.message : "Action confirmation unavailable.");
        return false;
      } finally {
        commandBusy.current = false;
        setPending(false);
      }
    },
    [incidentId],
  );

  return {
    snapshot: snapshot?.incident_id === incidentId ? snapshot : null,
    connection,
    error,
    pending,
    receivedAt,
    command,
  };
}
