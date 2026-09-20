"use client";

import { describeTranscript, type TranscriptionResult } from "./audio";
import type { TriageResult } from "./types";
import { useAudioTranscription } from "./useAudioTranscription";
import { useCameraTriage } from "./useCameraTriage";
import { useCaptureDevices } from "./useCaptureDevices";

interface CapturePanelProps {
  sourceId: string;
  /** Receives each accepted result so a workspace can publish it as an incident. */
  onResult?: (result: TriageResult) => void;
  onTranscript?: (result: TranscriptionResult) => void;
}

/**
 * Dashboard-sized capture. The full-page /capture view is for a phone held in
 * the hand; this is the same pipeline beside the map, which is how a Continuity
 * Camera is actually used: phone as the lens, laptop as the console.
 */
export function CapturePanel({ sourceId, onResult, onTranscript }: CapturePanelProps) {
  const { devices, cameraId, setCameraId, refreshDevices } = useCaptureDevices();

  const { state, videoRef, start, stop } = useCameraTriage({ sourceId, cameraId, onResult });
  const audio = useAudioTranscription(sourceId, onTranscript);
  const running = state.state === "running";
  const busy = running || state.state === "requesting-camera";
  const listening =
    audio.state.state === "recording" || audio.state.state === "requesting-microphone";

  async function startCamera() {
    // Freeze the choice before permission reveals more device names.
    setCameraId(cameraId);
    await start();
    await refreshDevices();
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

      {devices.cameras.length > 1 && (
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

      {audio.state.state === "requesting-microphone" && (
        <p className="capture-card__note">Waiting for microphone permission…</p>
      )}

      {state.state === "unsupported" && <p className="capture-card__error">{state.reason}</p>}
      {state.state === "denied" && <p className="capture-card__error">{state.reason}</p>}
      {audio.state.state === "unsupported" && (
        <p className="capture-card__error">{audio.state.reason}</p>
      )}

      {running && state.lastError && <p className="capture-card__error">{state.lastError}</p>}

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
