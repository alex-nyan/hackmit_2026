"use client";

import { useEffect } from "react";
import {
  DEMO_HANDOFF_CHANNEL,
  DEMO_HANDOFF_MAX_BYTES,
  DEMO_HANDOFF_STORAGE,
  allowedDemoParent,
  demoMessageRecord,
  demoSnapshotIsFresh,
  parseDemoHandoffSnapshot,
  validDemoClientId,
  type DemoHandoffSnapshot,
} from "./demoHandoff";

/** A same-browser storage relay only. It never calls an API or opens real dispatch channels. */
export function DemoHandoffBridge() {
  useEffect(() => {
    if (window.parent === window) return;
    const query = new URLSearchParams(window.location.search);
    const parentOrigin = query.get("parentOrigin") ?? "";
    const clientId = query.get("clientId") ?? "";
    if (!allowedDemoParent(parentOrigin, window.location.origin) || !validDemoClientId(clientId))
      return;
    let channel: BroadcastChannel | null = null;
    let snapshot: DemoHandoffSnapshot | null = null;

    const reply = (kind: "ready" | "snapshot" | "error", error?: string) => {
      window.parent.postMessage(
        { channel: DEMO_HANDOFF_CHANNEL, kind, clientId, snapshot, ...(error ? { error } : {}) },
        parentOrigin,
      );
    };
    const readStored = () => {
      const stored = localStorage.getItem(DEMO_HANDOFF_STORAGE);
      if (!stored || stored.length > DEMO_HANDOFF_MAX_BYTES) return null;
      return parseDemoHandoffSnapshot(JSON.parse(stored));
    };
    const accept = (next: DemoHandoffSnapshot) => {
      if (snapshot && Date.parse(next.updatedAt) < Date.parse(snapshot.updatedAt)) return;
      snapshot = next;
      reply("snapshot");
    };
    try {
      snapshot = readStored();
      if (typeof BroadcastChannel !== "undefined") {
        channel = new BroadcastChannel(DEMO_HANDOFF_CHANNEL);
        channel.onmessage = (event: MessageEvent<unknown>) => {
          const next = parseDemoHandoffSnapshot(event.data);
          if (next) accept(next);
        };
      }
    } catch {
      reply("error", "Browser storage is unavailable for this local demo handoff.");
    }

    const receive = (event: MessageEvent<unknown>) => {
      if (event.source !== window.parent || event.origin !== parentOrigin) return;
      const message = demoMessageRecord(event.data);
      if (!message || message.channel !== DEMO_HANDOFF_CHANNEL || message.clientId !== clientId)
        return;
      try {
        if (message.kind === "hello" || message.kind === "read") {
          snapshot = readStored();
          reply(message.kind === "hello" ? "ready" : "snapshot");
        } else if (message.kind === "publish") {
          const next = parseDemoHandoffSnapshot(message.snapshot);
          if (!next || next.publisherId !== clientId) {
            reply("error", "The demo handoff snapshot is invalid or too large.");
            return;
          }
          const stored = readStored();
          if (stored && stored.publisherId !== next.publisherId && demoSnapshotIsFresh(stored)) {
            snapshot = stored;
            reply(
              "error",
              "Another Command Centre tab owns this demo handoff. Keep one publisher open.",
            );
            return;
          }
          // Only the publisher writes its heartbeat; reads never make an old state fresh.
          localStorage.setItem(DEMO_HANDOFF_STORAGE, JSON.stringify(next));
          snapshot = next;
          channel?.postMessage(next);
          reply("snapshot");
        }
      } catch {
        reply("error", "Browser storage is unavailable for this local demo handoff.");
      }
    };
    const storage = (event: StorageEvent) => {
      if (event.key !== DEMO_HANDOFF_STORAGE) return;
      try {
        snapshot = readStored();
        reply("snapshot");
      } catch {
        reply("error", "The saved demo handoff could not be read.");
      }
    };
    window.addEventListener("message", receive);
    window.addEventListener("storage", storage);
    reply("ready");
    return () => {
      window.removeEventListener("message", receive);
      window.removeEventListener("storage", storage);
      channel?.close();
    };
  }, []);

  return null;
}
