"use client";

import { useEffect } from "react";
import { describeTranscript, type TranscriptionResult } from "./audio";
import { hasLabels } from "./devices";
import type { TriageResult } from "./types";
import { useAudioTranscription } from "./useAudioTranscription";
import { useCameraTriage } from "./useCameraTriage";
import { useCaptureDevices } from "./useCaptureDevices";

interface CapturePanelProps {
  sourceId: string;
  /** Receives each accepted result so a workspace can publish it as an incident. */
  onResult?: (result: TriageResult) => void;
  onTranscript?: (result: TranscriptionResult) => void;
  /** Local iPhone-labelled preview readiness, not identity or server/AI delivery. */
  onPhoneConnectionChange?: (sourceId: string, connected: boolean) => void;
}

/**
 * Dashboard-sized capture. The full-page /capture view is for a phone held in
 * the hand; this is the same pipeline beside the map, which is how a Continuity
 * Camera is actually used: phone as the lens, laptop as the console.
 */
export function CapturePanel({
  sourceId,
  onResult,
  onTranscript,
  onPhoneConnectionChange,
}: CapturePanelProps) {
  const { devices, cameraId, setCameraId, resolveDevices } = useCaptureDevices();

  const { state, videoRef, start, stop } = useCameraTriage({ sourceId, onResult });
  const audio = useAudioTranscription(sourceId, onTranscript);
  const running = state.state === "running";
  const busy = running || state.state === "requesting-camera";
  const listening =
    audio.state.state === "recording" || audio.state.state === "requesting-microphone";
  const deviceLabel = state.state === "running" ? state.deviceLabel : "";

  useEffect(() => {
    if (!onPhoneConnectionChange) return;
    let lastReported: boolean | undefined;
    const deliver = (connected: boolean) => {
      if (lastReported === connected) return;
      lastReported = connected;
      try {
        onPhoneConnectionChange(sourceId, connected);
      } catch {
        // A view-only observer must never interrupt capture or its cleanup.
      }
    };
    const video = videoRef.current;
    const stream =
      typeof MediaStream !== "undefined" && video?.srcObject instanceof MediaStream
        ? video.srcObject
        : null;
    const tracks = stream?.getVideoTracks() ?? [];
    if (!running || !/iphone/i.test(deviceLabel) || !video || !stream || !tracks.length) {
      deliver(false);
      return;
    }
    let blocked = false;
    let previousPosition = video.currentTime;
    let lastAdvance = Number.NEGATIVE_INFINITY;
    const report = () => {
      const now = performance.now();
      const position = video.currentTime;
      if (Number.isFinite(position) && position > previousPosition) lastAdvance = now;
      else if (!Number.isFinite(position) || position < previousPosition)
        lastAdvance = Number.NEGATIVE_INFINITY;
      previousPosition = position;
      // A playing element alone is not evidence of a fresh preview. Require its
      // media clock to advance, and turn the indicator off after three seconds.
      deliver(
        Boolean(
          !blocked &&
          now - lastAdvance <= 3_000 &&
          video.srcObject === stream &&
          video.readyState >= 2 &&
          !video.paused &&
          !video.ended &&
          !video.error &&
          tracks.some((track) => track.readyState === "live" && track.enabled && !track.muted),
        ),
      );
    };
    const block = () => {
      blocked = true;
      lastAdvance = Number.NEGATIVE_INFINITY;
      deliver(false);
    };
    const playing = () => {
      blocked = false;
      previousPosition = video.currentTime;
      lastAdvance = Number.NEGATIVE_INFINITY;
      report();
    };
    const trackChanged = () => {
      previousPosition = video.currentTime;
      lastAdvance = Number.NEGATIVE_INFINITY;
      report();
    };
    const blockedVideoEvents = ["waiting", "stalled", "pause", "ended", "emptied", "error"];
    const trackEvents = ["ended", "mute", "unmute"];
    blockedVideoEvents.forEach((event) => video.addEventListener(event, block));
    video.addEventListener("playing", playing);
    video.addEventListener("timeupdate", report);
    tracks.forEach((track) =>
      trackEvents.forEach((event) => track.addEventListener(event, trackChanged)),
    );
    const watchdog = setInterval(report, 250);
    report();
    return () => {
      clearInterval(watchdog);
      blockedVideoEvents.forEach((event) => video.removeEventListener(event, block));
      video.removeEventListener("playing", playing);
      video.removeEventListener("timeupdate", report);
      tracks.forEach((track) =>
        trackEvents.forEach((event) => track.removeEventListener(event, trackChanged)),
      );
      deliver(false);
    };
  }, [deviceLabel, onPhoneConnectionChange, running, sourceId, videoRef]);

  async function startCamera() {
    // Permission is what reveals device names, so the phone can only be
    // preferred over the built-in webcam once the list has been asked for.
    const chosen = await resolveDevices();
    await start(chosen.cameraId);
  }

  const selected = devices.cameras.find((device) => device.deviceId === cameraId);

  return (
    <aside className="capture-card" aria-label="Camera">
      <span className="capture-card__eyebrow">Camera</span>

      <video
        ref={videoRef}
        className="capture-card__video"
        data-live={busy ? "true" : undefined}
        playsInline
        muted
        autoPlay
      />

      {devices.cameras.length > 1 && hasLabels(devices.cameras) && (
        <select
          className="capture-card__picker"
          value={cameraId ?? ""}
          onChange={(event) => setCameraId(event.target.value || null)}
          disabled={busy}
          aria-label="Camera source"
        >
          <option value="">Default camera</option>
          {devices.cameras.map((device) => (
            <option key={device.deviceId} value={device.deviceId}>
              {device.label || "Camera"}
            </option>
          ))}
        </select>
      )}

      <div className="capture-card__actions">
        <button
          type="button"
          className="capture-card__button"
          data-stop={busy ? "true" : undefined}
          onClick={() => (busy ? stop() : void startCamera())}
        >
          {busy ? "Stop" : "Start"}
        </button>
        <button
          type="button"
          className="capture-card__button capture-card__button--quiet"
          data-on={listening ? "true" : undefined}
          onClick={() => (listening ? audio.stop() : void audio.start())}
        >
          {listening ? "Mute" : "Listen"}
        </button>
      </div>

      {!busy && selected && <p className="capture-card__note">Selected: {selected.label}</p>}

      {/* Name the camera that is actually open: a body camera running on the
          laptop's own lens looks identical to one running on the phone. */}
      {running && state.deviceLabel && (
        <p className="capture-card__note">Live on {state.deviceLabel}</p>
      )}

      {audio.state.state === "requesting-microphone" && (
        <p className="capture-card__note">Waiting for microphone permission…</p>
      )}

      {state.state === "unsupported" && <p className="capture-card__error">{state.reason}</p>}
      {state.state === "denied" && <p className="capture-card__error">{state.reason}</p>}
      {audio.state.state === "unsupported" && (
        <p className="capture-card__error">{audio.state.reason}</p>
      )}

      {running && state.lastError && <p className="capture-card__error">{state.lastError}</p>}

      {/* No triage service behind this deployment. Worth saying once, plainly:
          the capture is still working and still feeding the wall. */}
      {running && !state.triageConfigured && (
        <p className="capture-card__note">
          No hazard triage configured here. Frames are still publishing to the body camera wall.
        </p>
      )}

      {running && state.lastResult && (
        <div className="capture-card__result">
          <span className="capture-card__priority" data-level={state.lastResult.review_priority}>
            {state.lastResult.review_priority.replace(/_/g, " ")}
          </span>
          <p>{state.lastResult.assessment?.summary ?? "No assessment returned."}</p>
        </div>
      )}

      {audio.state.state === "recording" && (
        <div className="capture-card__result">
          <span className="capture-card__eyebrow">Heard</span>
          {audio.state.lastError ? (
            <p className="capture-card__error">{audio.state.lastError}</p>
          ) : (
            <p>
              {audio.state.lastResult ? describeTranscript(audio.state.lastResult) : "Listening…"}
            </p>
          )}
        </div>
      )}

      {(running || audio.state.state === "recording") && (
        // The service never clears a scene, and a transcript is a guess.
        <p className="capture-card__caveat">Model output for a person to review, not a decision.</p>
      )}
    </aside>
  );
}
