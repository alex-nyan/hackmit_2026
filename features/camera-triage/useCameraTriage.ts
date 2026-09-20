"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { trackConstraint } from "./devices";
import { buildTriageRequest, nextDelayMs, type FrameOutcome } from "./frame";
import type { CaptureState, TriageResult } from "./types";
import { useWakeLock } from "./useWakeLock";

const BASE_INTERVAL_MS = 2000;
const CAPTURE_WIDTH = 1280;
const JPEG_QUALITY = 0.72;
/** A phone that has just been asked for itself needs a moment to wake. */
const WAKE_MS = 600;

/**
 * getUserMedia rejects with a DOMException, whose relationship to Error
 * differs between a browser and jsdom. Read the name off the object instead,
 * so a declined permission is recognised the same way in both.
 */
function errorName(error: unknown): string {
  return typeof error === "object" && error !== null && "name" in error
    ? String((error as { name: unknown }).name)
    : "";
}

/**
 * Open one camera, allowing for a Continuity Camera that is still waking.
 *
 * Naming an exact device is the only way to reach the iPhone, but an exact
 * device that is not ready yet fails outright rather than waiting, and the
 * capture before this one may have been the permission prompt that woke it.
 * So: try, wait, try once more, and only then settle for whatever camera the
 * browser will give. A declined permission is a decision, not a wait, and is
 * never retried. Whichever camera opens, the panel names it.
 */
async function openCamera(deviceId: string | null): Promise<MediaStream> {
  const wanted: MediaStreamConstraints = {
    video: deviceId
      ? trackConstraint(deviceId)
      : { facingMode: "environment", width: { ideal: CAPTURE_WIDTH } },
    audio: false,
  };

  try {
    return await navigator.mediaDevices.getUserMedia(wanted);
  } catch (error) {
    if (!deviceId || errorName(error) === "NotAllowedError") throw error;
    await new Promise((resolve) => setTimeout(resolve, WAKE_MS));
    try {
      return await navigator.mediaDevices.getUserMedia(wanted);
    } catch {
      return await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    }
  }
}

interface Options {
  sourceId: string;
  incidentId?: string | null;
  /**
   * Called once per accepted result. Held in a ref so a caller that rebuilds
   * the callback each render does not cancel the request in flight.
   */
  onResult?: (result: TriageResult) => void;
}

/**
 * Holds the camera and feeds one frame at a time to the triage route. The
 * service admits a single frame at a time, so the next capture is scheduled
 * only after the previous request settles; a fixed interval would queue frames
 * until they aged past the service's staleness limit.
 */
export function useCameraTriage({ sourceId, incidentId, onResult }: Options) {
  const [state, setState] = useState<CaptureState>({ state: "idle" });
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sessionRef = useRef<symbol | null>(null);
  const optionsRef = useRef({ sourceId, incidentId });
  const onResultRef = useRef(onResult);

  useEffect(() => {
    optionsRef.current = { sourceId, incidentId };
  }, [sourceId, incidentId]);

  useEffect(() => {
    onResultRef.current = onResult;
  }, [onResult]);

  const stop = useCallback(() => {
    sessionRef.current = null;
    streamRef.current?.getTracks().forEach((track) => {
      track.onended = null;
      track.stop();
    });
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setState({ state: "idle" });
  }, []);

  /**
   * The capture device is an argument rather than a prop because a Continuity
   * Camera can only be identified once permission has revealed device names.
   * The caller resolves it at the moment of the click and hands the answer
   * straight to the acquisition, with no render in between to go stale.
   */
  const start = useCallback(
    async (deviceId: string | null = null) => {
      if (sessionRef.current) return;

      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
        // Safari exposes mediaDevices only in a secure context, so this is the
        // symptom of plain HTTP far more often than an old browser.
        setState({
          state: "unsupported",
          reason:
            "Camera access needs a secure context. Open this page over HTTPS, or on localhost.",
        });
        return;
      }

      // Reserve the session before awaiting permission so repeated starts cannot
      // open extra streams. Stop also invalidates pending acquisition/playback.
      const session = Symbol();
      sessionRef.current = session;
      setState({ state: "requesting-camera" });
      try {
        const stream = await openCamera(deviceId);
        if (sessionRef.current !== session) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        stream.getTracks().forEach((track) => {
          track.onended = () => {
            if (sessionRef.current !== session) return;
            stop();
            setState({
              state: "denied",
              reason: "Camera capture ended. Start the camera to try again.",
            });
          };
        });
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play().catch(() => undefined);
        }
        if (sessionRef.current !== session) return;
        const [camera] = stream.getTracks().filter((track) => track.kind === "video");
        setState({
          state: "running",
          deviceLabel: camera?.label ?? "",
          triageConfigured: true,
          lastResult: null,
          lastError: null,
        });
      } catch (error) {
        if (sessionRef.current !== session) return;
        sessionRef.current = null;
        streamRef.current?.getTracks().forEach((track) => {
          track.onended = null;
          track.stop();
        });
        streamRef.current = null;
        if (videoRef.current) videoRef.current.srcObject = null;
        const name = errorName(error);
        setState({
          state: "denied",
          reason:
            name === "NotAllowedError"
              ? "Camera permission was declined."
              : "No usable camera was found.",
        });
      }
    },
    [stop],
  );

  useEffect(() => {
    if (state.state !== "running") return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const canvas = document.createElement("canvas");

    async function sendOneFrame(): Promise<FrameOutcome> {
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

      // A deployment with no triage service says so once and keeps going. It
      // is a fact about the deployment, not a fault to report every two
      // seconds, and the frames still reach the body camera wall.
      if (response.status === 503) {
        const reason = (await response.json().catch(() => null)) as { error?: unknown } | null;
        if (reason?.error === "not-configured") {
          if (!cancelled) {
            setState((current) =>
              current.state === "running"
                ? { ...current, triageConfigured: false, lastError: null }
                : current,
            );
          }
          return "unconfigured" as const;
        }
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
            ? { ...current, lastResult: result, lastError: null }
            : current,
        );
        // A subscriber's own failure must not abort the capture loop.
        try {
          onResultRef.current?.(result);
        } catch {
          // Reported by the subscriber, not here.
        }
      }
      return "ok" as const;
    }

    async function loop() {
      let outcome: FrameOutcome = "error";
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

  // A capture that is running is a camera someone is relying on; the screen
  // going to sleep would end it without anyone deciding to.
  useWakeLock(state.state === "running" || state.state === "requesting-camera");

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
