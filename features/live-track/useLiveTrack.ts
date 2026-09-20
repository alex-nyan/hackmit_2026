"use client";

import { useEffect, useRef, useState } from "react";

import type { LiveDevice, LiveFix, LiveTrackPayload, LiveTrackState } from "./types";

const POLL_INTERVAL_MS = 5000;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function optionalNonnegative(value: unknown): boolean {
  return value === null || (finite(value) && value >= 0);
}

function validFix(value: unknown): value is LiveFix | null {
  if (value === null) return true;
  const fix = record(value);
  return Boolean(
    fix &&
    finite(fix.longitude) &&
    Math.abs(fix.longitude) <= 180 &&
    finite(fix.latitude) &&
    Math.abs(fix.latitude) <= 90 &&
    optionalNonnegative(fix.accuracyMeters) &&
    optionalNonnegative(fix.speedKmh) &&
    (fix.headingDegrees === null ||
      (finite(fix.headingDegrees) && fix.headingDegrees >= 0 && fix.headingDegrees <= 360)) &&
    typeof fix.fixedAt === "string" &&
    Number.isFinite(Date.parse(fix.fixedAt)) &&
    finite(fix.ageSeconds) &&
    fix.ageSeconds >= 0 &&
    ["live", "stale", "lost"].includes(String(fix.freshness)),
  );
}

function validDevice(value: unknown): value is LiveDevice {
  const device = record(value);
  return Boolean(
    device &&
    typeof device.id === "string" &&
    device.id.length > 0 &&
    typeof device.name === "string" &&
    typeof device.online === "boolean" &&
    validFix(device.fix),
  );
}

function parsePayload(value: unknown): LiveTrackPayload | null {
  const payload = record(value);
  if (!payload) return null;
  if (payload.state === "not-configured") return { state: "not-configured" };
  if (payload.state === "unavailable") {
    return typeof payload.reason === "string"
      ? { state: "unavailable", reason: payload.reason }
      : null;
  }
  if (payload.note !== undefined && typeof payload.note !== "string") return null;
  const note = typeof payload.note === "string" ? { note: payload.note } : {};
  if (payload.state === "no-devices") return { state: "no-devices", ...note };
  if (
    payload.state === "tracking" &&
    Array.isArray(payload.devices) &&
    payload.devices.every(validDevice)
  ) {
    return { state: "tracking", devices: payload.devices, ...note };
  }
  return null;
}

/**
 * Polls the server route while tracking is switched on. Only the latest fix is
 * held; no location history is retained in the browser. Turning tracking off
 * aborts the in-flight request and drops the fix.
 */
export function useLiveTrack(enabled: boolean): LiveTrackState {
  const [payload, setPayload] = useState<LiveTrackPayload | null>(null);
  const [lastEnabled, setLastEnabled] = useState(enabled);
  const abortRef = useRef<AbortController | null>(null);

  // Toggling clears the previous answer during render, so a re-enabled panel
  // never shows the fix from the last session before the first poll returns.
  if (lastEnabled !== enabled) {
    setLastEnabled(enabled);
    setPayload(null);
  }

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function poll() {
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const response = await fetch("/api/live-position", {
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]),
          cache: "no-store",
        });
        if (!response.ok) {
          if (!cancelled)
            setPayload({
              state: "unavailable",
              reason:
                response.status === 401 || response.status === 403
                  ? "Tracking access expired or was denied. Unlock or sign in again."
                  : `The tracking service returned ${response.status}. Positions are unavailable.`,
            });
          return;
        }
        const next = parsePayload(await response.json());
        if (!next) {
          if (!cancelled)
            setPayload({
              state: "unavailable",
              reason: "Invalid tracking data was rejected. Positions are unavailable.",
            });
          return;
        }
        if (!cancelled) setPayload(next);
      } catch {
        if (!cancelled) {
          setPayload({
            state: "unavailable",
            reason: "The dashboard could not reach its tracking route.",
          });
        }
      } finally {
        if (!cancelled) timer = setTimeout(poll, POLL_INTERVAL_MS);
      }
    }

    void poll();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, [enabled]);

  if (!enabled) return { state: "idle" };
  return payload ?? { state: "connecting" };
}
