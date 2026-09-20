"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { buildTriageRequest, nextDelayMs } from "./frame";
import type { CaptureState, TriageResult } from "./types";

const BASE_INTERVAL_MS = 2000;
const CAPTURE_WIDTH = 1280;
const JPEG_QUALITY = 0.72;

interface Options {
  sourceId: string;
  incidentId?: string | null;
}

/**
 * Holds the camera and feeds one frame at a time to the triage route. The
 * service admits a single frame at a time, so the next capture is scheduled
 * only after the previous request settles; a fixed interval would queue frames
 * until they aged past the service's staleness limit.
 */
export function useCameraTriage({ sourceId, incidentId }: Options) {
  const [state, setState] = useState<CaptureState>({ state: "idle" });
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sessionRef = useRef<symbol | null>(null);
  const optionsRef = useRef({ sourceId, incidentId });

  useEffect(() => {
    optionsRef.current = { sourceId, incidentId };
  }, [sourceId, incidentId]);

  const stop = useCallback(() => {
    sessionRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setState({ state: "idle" });
  }, []);

  const start = useCallback(async () => {
    if (sessionRef.current) return;

    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      // Safari exposes mediaDevices only in a secure context, so this is the
      // symptom of plain HTTP far more often than an old browser.
      setState({
        state: "unsupported",
        reason: "Camera access needs a secure context. Open this page over HTTPS, or on localhost.",
      });
      return;
    }

    // Reserve the session before awaiting permission so repeated starts cannot
    // open extra streams. Stop also invalidates pending acquisition/playback.
    const session = Symbol();
    sessionRef.current = session;
    setState({ state: "requesting-camera" });
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: CAPTURE_WIDTH } },
        audio: false,
      });
      if (sessionRef.current !== session) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        await video.play().catch(() => undefined);
      }
      if (sessionRef.current !== session) return;
      setState({ state: "running", lastResult: null, lastError: null });
    } catch (error) {
      if (sessionRef.current !== session) return;
      sessionRef.current = null;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      if (videoRef.current) videoRef.current.srcObject = null;
      const name = error instanceof Error ? error.name : "";
      setState({
        state: "denied",
        reason:
          name === "NotAllowedError"
            ? "Camera permission was declined."
            : "No usable camera was found.",
      });
    }
  }, []);

  useEffect(() => {
    if (state.state !== "running") return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const canvas = document.createElement("canvas");

    async function sendOneFrame() {
      const video = videoRef.current;
      if (!video || video.videoWidth === 0) return "error" as const;

      const scale = Math.min(1, CAPTURE_WIDTH / video.videoWidth);
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      const context = canvas.getContext("2d");
      if (!context) return "error" as const;
      context.drawImage(video, 0, 0, canvas.width, canvas.height);

      const body = buildTriageRequest({
        dataUrl: canvas.toDataURL("image/jpeg", JPEG_QUALITY),
        sourceId: optionsRef.current.sourceId,
        capturedAt: new Date(),
        incidentId: optionsRef.current.incidentId,
      });
      if (!body) return "error" as const;

      const response = await fetch("/api/triage", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify(body),
        cache: "no-store",
      });

      if (response.status === 429) {
        if (!cancelled) {
          setState((current) =>
            current.state === "running" ? { ...current, lastError: null } : current,
          );
        }
        return "busy" as const;
      }

      if (!response.ok) {
        if (!cancelled) {
          setState((current) =>
            current.state === "running"
              ? { ...current, lastError: `Triage service returned ${response.status}.` }
              : current,
          );
        }
        return "error" as const;
      }

      const result = (await response.json()) as TriageResult;
      if (!cancelled) {
        setState((current) =>
          current.state === "running"
            ? { state: "running", lastResult: result, lastError: null }
            : current,
        );
      }
      return "ok" as const;
    }

    async function loop() {
      let outcome: "ok" | "busy" | "error" = "error";
      try {
        outcome = await sendOneFrame();
      } catch {
        if (!cancelled) {
          setState((current) =>
            current.state === "running"
              ? { ...current, lastError: "Could not reach the triage route." }
              : current,
          );
        }
      } finally {
        if (!cancelled) timer = setTimeout(loop, nextDelayMs(outcome, BASE_INTERVAL_MS));
      }
    }

    void loop();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // Restarting the loop on every result would cancel the request in flight.
  }, [state.state]);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.hidden && sessionRef.current) stop();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      stop();
    };
  }, [stop]);

  return { state, videoRef, start, stop };
}
