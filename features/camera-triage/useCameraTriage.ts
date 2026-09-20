"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { ContractValidationError, parseTriageResult } from "../../shared/contracts";
import { buildTriageRequest, nextDelayMs, type FrameOutcome } from "./frame";
import {
  CAPTURE_REQUEST_WIDTH,
  INITIAL_LADDER,
  afterUpload,
  encodingAt,
  linkTimeMs,
} from "./frameQuality";
import type { CaptureState, TriageResult } from "./types";
import { useWakeLock } from "./useWakeLock";

const BASE_INTERVAL_MS = 2000;
/** A phone that has just been asked for itself needs a moment to wake. */
const WAKE_MS = 600;
/**
 * The frame-analysis pipeline scales its own JPEGs down, but the direct
 * officer-to-officer stream shares this source track. Ask Continuity Camera
 * for enough detail for a person to read a plate, doorway, or hand signal;
 * the 30 fps ceiling leaves the encoder bandwidth for those details instead
 * of spending it on frames a wall cannot use.
 */
const LIVE_CAMERA_CONSTRAINTS: MediaTrackConstraints = {
  width: { ideal: 1920 },
  height: { ideal: 1080 },
  aspectRatio: { ideal: 16 / 9 },
  frameRate: { ideal: 30, max: 30 },
};

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
      ? { deviceId: { exact: deviceId }, ...LIVE_CAMERA_CONSTRAINTS }
      : {
          facingMode: "environment",
          ...LIVE_CAMERA_CONSTRAINTS,
          // Keep this explicit because the triage ladder relies on the
          // source being at least as large as its top rung.
          width: { ideal: Math.max(1920, CAPTURE_REQUEST_WIDTH) },
        },
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
  intervalMs?: number;
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
export function useCameraTriage({
  sourceId,
  incidentId,
  onResult,
  intervalMs = BASE_INTERVAL_MS,
}: Options) {
  const [state, setState] = useState<CaptureState>({ state: "idle" });
  /**
   * The open track, as state as well as a ref.
   *
   * The ref is what this hook's own loop reads; the state is what anything
   * outside it can react to. A live link to a watching dashboard is built
   * from this track, and the hook that builds it has to re-render when the
   * camera opens and closes rather than reading a ref that silently changed.
   */
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sessionRef = useRef<symbol | null>(null);
  const ladderRef = useRef(INITIAL_LADDER);
  const optionsRef = useRef({ sourceId, incidentId });
  const onResultRef = useRef(onResult);
  const intervalRef = useRef(intervalMs);
  useEffect(() => {
    intervalRef.current = intervalMs;
  }, [intervalMs]);

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
    setCameraStream(null);
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
      // A new capture re-measures. Inheriting the last session's rung would
      // hold a picture down for a link that is no longer the one it met.
      ladderRef.current = INITIAL_LADDER;

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
        // The same camera track feeds both triage snapshots and the direct
        // officer link. For the latter, detail matters more than a silky frame
        // rate: browsers that honour this hint select an encoder mode suited
        // to readable scenes rather than a video-call preview.
        stream.getVideoTracks().forEach((track) => {
          track.contentHint = "detail";
        });
        setCameraStream(stream);
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
          encoding: encodingAt(ladderRef.current),
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
        setCameraStream(null);
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

      const encoding = encodingAt(ladderRef.current);
      const scale = Math.min(1, encoding.width / video.videoWidth);
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      const context = canvas.getContext("2d");
      if (!context) return "error" as const;
      context.drawImage(video, 0, 0, canvas.width, canvas.height);

      const body = buildTriageRequest({
        dataUrl: canvas.toDataURL("image/jpeg", encoding.quality),
        sourceId: optionsRef.current.sourceId,
        capturedAt: new Date(),
        incidentId: optionsRef.current.incidentId,
      });
      if (!body) return "error" as const;

      /**
       * Steers the next frame's size on what the link just did. Only an upload
       * that completed is a measurement: a refusal says the model is busy and
       * a failure says nothing at all, and shrinking the picture for either
       * would be reading the wrong signal.
       */
      const startedAt = performance.now();
      const settle = (serverMs: number | undefined) => {
        const next = afterUpload(
          ladderRef.current,
          linkTimeMs(performance.now() - startedAt, serverMs),
        );
        if (next.index === ladderRef.current.index) {
          ladderRef.current = next;
          return;
        }
        ladderRef.current = next;
        const moved = encodingAt(next);
        if (!cancelled) {
          setState((current) =>
            current.state === "running" ? { ...current, encoding: moved } : current,
          );
        }
      };

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
          // The whole frame was still uploaded, and no model was involved, so
          // this is the cleanest link measurement the loop ever gets.
          settle(undefined);
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

      const result = parseTriageResult(await response.json());
      settle(result.timings_ms?.total);
      if (!cancelled) {
        setState((current) =>
          current.state === "running"
            ? {
                ...current,
                lastResult: result,
                lastError:
                  response.headers.get("X-Incident-Publication") === "failed"
                    ? "Analysis received, but sharing to the incident log failed."
                    : null,
              }
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
      } catch (error) {
        if (!cancelled) {
          setState((current) =>
            current.state === "running"
              ? {
                  ...current,
                  lastError:
                    error instanceof ContractValidationError
                      ? "Invalid triage response. Human review data is unavailable."
                      : "Could not reach the triage route.",
                }
              : current,
          );
        }
      } finally {
        if (!cancelled) timer = setTimeout(loop, nextDelayMs(outcome, intervalRef.current));
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

  return { state, videoRef, start, stop, stream: cameraStream };
}
