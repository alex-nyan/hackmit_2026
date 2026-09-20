"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { PublisherPresence } from "@/features/live-video/presence";

import type { FrameSummary } from "./frames";

const ENDPOINT = "/api/streams";
const POLL_MS = 1_500;
const REQUEST_TIMEOUT_MS = 8_000;
/** A brief missed lease/listing cannot tear down a working peer connection. */
const DISCOVERY_GRACE_MS = 30_000;

export type WallStatus = "connecting" | "live" | "offline";

export interface WallSource {
  sourceId: string;
  frame: FrameSummary | null;
  publisher: PublisherPresence | null;
  lastSeen: number;
}

/**
 * Discovers cameras independently from their optional AI snapshots.
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
  const [publishers, setPublishers] = useState<PublisherPresence[]>([]);
  const [sources, setSources] = useState<WallSource[]>([]);
  const [status, setStatus] = useState<WallStatus>("connecting");
  const liveSources = useRef(new Set<string>());
  const setSourceLive = useCallback((sourceId: string, live: boolean) => {
    if (live) liveSources.current.add(sourceId);
    else liveSources.current.delete(sourceId);
  }, []);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let inFlight: AbortController | undefined;
    let lastFrames: FrameSummary[] = [];
    let lastPublishers: PublisherPresence[] = [];

    async function poll() {
      const request = new AbortController();
      inFlight = request;
      const timeout = setTimeout(() => request.abort(), REQUEST_TIMEOUT_MS);
      try {
        const response = await fetch(ENDPOINT, {
          cache: "no-store",
          signal: request.signal,
        });
        if (!response.ok) throw new Error(String(response.status));
        const body = (await response.json()) as {
          frames?: unknown;
          publishers?: unknown;
          framesAvailable?: boolean;
          publishersAvailable?: boolean;
        };
        if (stopped) return;
        if (body.framesAvailable !== false) {
          lastFrames = Array.isArray(body.frames) ? (body.frames as FrameSummary[]) : [];
          setFrames(lastFrames);
        }
        if (body.publishersAvailable !== false) {
          lastPublishers = Array.isArray(body.publishers)
            ? (body.publishers as PublisherPresence[])
            : [];
          setPublishers(lastPublishers);
        }
        const now = Date.now();
        setSources((previous) => {
          const frameBySource = new Map(lastFrames.map((frame) => [frame.sourceId, frame]));
          const publisherBySource = new Map(
            lastPublishers.map((publisher) => [publisher.sourceId, publisher]),
          );
          const merged = new Map(
            previous.map((source) => [
              source.sourceId,
              {
                ...source,
                frame: frameBySource.get(source.sourceId) ?? null,
                publisher: publisherBySource.get(source.sourceId) ?? null,
              },
            ]),
          );
          const discovered = new Set([
            ...lastFrames.map((frame) => frame.sourceId),
            ...lastPublishers.map((publisher) => publisher.sourceId),
          ]);
          for (const sourceId of discovered) {
            merged.set(sourceId, {
              sourceId,
              frame: frameBySource.get(sourceId) ?? null,
              publisher: publisherBySource.get(sourceId) ?? null,
              lastSeen: now,
            });
          }
          return [...merged.values()]
            .filter(
              (source) =>
                now - source.lastSeen <= DISCOVERY_GRACE_MS ||
                liveSources.current.has(source.sourceId),
            )
            .sort((a, b) => a.sourceId.localeCompare(b.sourceId));
        });
        setStatus(
          body.framesAvailable === false || body.publishersAvailable === false ? "offline" : "live",
        );
      } catch {
        // A failed poll is not an empty wall: the last roster stays on screen
        // and the status says it can no longer be trusted.
        if (!stopped) setStatus("offline");
      } finally {
        clearTimeout(timeout);
        if (!stopped) timer = setTimeout(() => void poll(), POLL_MS);
      }
    }

    void poll();

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      inFlight?.abort();
    };
  }, []);

  return { frames, publishers, sources, status, setSourceLive };
}
