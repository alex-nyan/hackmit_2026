"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { DemoAmbulanceMission } from "./demoAmbulance";
import {
  DEMO_HANDOFF_CHANNEL,
  demoBridgeOrigin,
  demoMessageRecord,
  demoSnapshotIsFresh,
  makeDemoHandoffSnapshot,
  parseDemoHandoffSnapshot,
  type DemoHandoffSnapshot,
} from "./demoHandoff";

interface Props {
  publisher: boolean;
  missions: DemoAmbulanceMission[];
}

type HandoffState = {
  missions: DemoAmbulanceMission[];
  status: "connecting" | "synced" | "offline";
  updatedAt: string | null;
};

/** Same browser only. No backend, real-device transport, or multi-device synchronization. */
export function useDemoHandoff({
  publisher,
  missions,
}: Props): HandoffState & { bridge: ReactNode } {
  const [frame, setFrame] = useState<HTMLIFrameElement | null>(null);
  const ownerClientId = useRef<string | null>(null);
  const latest = useRef({ publisher, missions });
  const [state, setState] = useState<HandoffState>({
    missions: [],
    status: "connecting",
    updatedAt: null,
  });
  const attachFrame = useCallback((node: HTMLIFrameElement | null) => {
    setFrame(node);
    // Role navigation can replace the physical iframe without remounting this
    // hook. Reconnect that node, but keep the publisher lease identity below.
    setState((previous) => ({ ...previous, status: node ? "connecting" : "offline" }));
  }, []);

  useEffect(() => {
    latest.current = { publisher, missions };
  }, [publisher, missions]);

  useEffect(() => {
    if (!frame) return;
    const origin = demoBridgeOrigin(window.location.origin);
    if (!ownerClientId.current) {
      ownerClientId.current = `demo_${crypto.randomUUID().replaceAll("-", "")}`;
    }
    const clientId = ownerClientId.current;
    const url = new URL("/demo-handoff", origin);
    url.searchParams.set("parentOrigin", window.location.origin);
    url.searchParams.set("clientId", clientId);
    let ready = false;
    let failed = false;
    let snapshot: DemoHandoffSnapshot | null = null;
    const started = Date.now();

    const send = (kind: "hello" | "read" | "publish", value?: DemoHandoffSnapshot) => {
      frame.contentWindow?.postMessage(
        { channel: DEMO_HANDOFF_CHANNEL, kind, clientId, ...(value ? { snapshot: value } : {}) },
        origin,
      );
    };
    const refresh = () => {
      const ownsMissions = latest.current.publisher && latest.current.missions.length > 0;
      const conflictingOwner = ownsMissions && snapshot && snapshot.publisherId !== clientId;
      const status: HandoffState["status"] =
        failed || conflictingOwner
          ? "offline"
          : snapshot
            ? demoSnapshotIsFresh(snapshot)
              ? "synced"
              : "offline"
            : Date.now() - started < 5_000
              ? "connecting"
              : "offline";
      setState((previous) => {
        const updatedAt = snapshot?.updatedAt ?? null;
        if (previous.status === status && previous.updatedAt === updatedAt) return previous;
        return { status, missions: snapshot?.missions ?? [], updatedAt };
      });
    };
    const transmit = () => {
      if (!ready) {
        send("hello");
      } else if (latest.current.publisher && latest.current.missions.length > 0) {
        const next = makeDemoHandoffSnapshot(clientId, latest.current.missions);
        if (!next) {
          failed = true;
          refresh();
          return;
        }
        send("publish", next);
      } else {
        send("read");
      }
    };
    const receive = (event: MessageEvent<unknown>) => {
      if (event.origin !== origin || event.source !== frame.contentWindow) return;
      const message = demoMessageRecord(event.data);
      if (!message || message.channel !== DEMO_HANDOFF_CHANNEL || message.clientId !== clientId)
        return;
      if (message.kind === "error") {
        failed = true;
        refresh();
        return;
      }
      if (message.kind !== "ready" && message.kind !== "snapshot") return;
      const parsed = message.snapshot === null ? null : parseDemoHandoffSnapshot(message.snapshot);
      if (message.snapshot !== null && !parsed) return;
      snapshot = parsed;
      failed = false;
      ready = true;
      refresh();
      if (message.kind === "ready") transmit();
    };
    const load = () => {
      ready = false;
      transmit();
    };
    window.addEventListener("message", receive);
    frame.addEventListener("load", load);
    // Keep the iframe hidden and out of accessibility navigation. The destination
    // is chosen after mounting so server markup never guesses the browser origin.
    frame.setAttribute("src", url.toString());
    const heartbeat = setInterval(transmit, 2_000);
    const freshness = setInterval(refresh, 1_000);
    return () => {
      clearInterval(heartbeat);
      clearInterval(freshness);
      window.removeEventListener("message", receive);
      frame.removeEventListener("load", load);
    };
  }, [frame]);

  return {
    ...state,
    bridge: (
      <iframe
        ref={attachFrame}
        title="Local demo handoff bridge"
        hidden
        aria-hidden="true"
        tabIndex={-1}
      />
    ),
  };
}
