"use client";

import { useState } from "react";

import { describeTranscript } from "./audio";
import styles from "./CameraTriageView.module.css";
import { useAudioTranscription } from "./useAudioTranscription";
import { useCameraTriage } from "./useCameraTriage";
import { useCaptureDevices } from "./useCaptureDevices";

export function CameraTriageView() {
  const [sourceId, setSourceId] = useState("unit-01");
  const { devices, cameraId, setCameraId, refreshDevices } = useCaptureDevices();
  const { state, videoRef, start, stop } = useCameraTriage({ sourceId, cameraId });
  const audio = useAudioTranscription(sourceId);
  const running = state.state === "running";
  const listening =
    audio.state.state === "recording" || audio.state.state === "requesting-microphone";
  const active = running || state.state === "requesting-camera";

  async function startCamera() {
    setCameraId(cameraId);
    await start();
    await refreshDevices();
  }

  return (
    <main className={styles.root}>
      <div className={styles.stage}>
        <video ref={videoRef} className={styles.video} playsInline muted autoPlay />
      </div>

      <section className={styles.panel}>
        <div className={styles.row}>
          <input
            className={styles.field}
            value={sourceId}
            onChange={(event) => setSourceId(event.target.value)}
            placeholder="Unit name"
            aria-label="Unit name"
            disabled={active || listening}
          />
          <button
            type="button"
            className={styles.button}
            data-stop={active ? "true" : undefined}
            onClick={() => (active ? stop() : void startCamera())}
          >
            {active ? "Stop" : "Start"}
          </button>
        </div>

        {devices.cameras.length > 1 && (
          <select
            className={styles.picker}
            value={cameraId ?? ""}
            onChange={(event) => setCameraId(event.target.value || null)}
            disabled={active}
            aria-label="Camera"
          >
            <option value="">Default camera</option>
            {devices.cameras.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label || "Camera"}
              </option>
            ))}
          </select>
        )}

        <div className={styles.row}>
          <button
            type="button"
            className={styles.secondary}
            data-on={listening ? "true" : undefined}
            onClick={() => (listening ? audio.stop() : void audio.start())}
          >
            {listening ? "Stop listening" : "Also transcribe audio"}
          </button>
        </div>

        {audio.state.state === "unsupported" && (
          <p className={styles.error}>{audio.state.reason}</p>
        )}

        {audio.state.state === "requesting-microphone" && (
          <p className={styles.notice}>Waiting for microphone permission…</p>
        )}

        {audio.state.state === "recording" && (
          <div className={styles.result}>
            <span className={styles.heard}>Heard</span>
            {audio.state.lastError ? (
              <p className={styles.error}>{audio.state.lastError}</p>
            ) : audio.state.lastResult ? (
              <>
                <p className={styles.summary}>{describeTranscript(audio.state.lastResult)}</p>
                {/* A transcript is what a model guessed, not what was said. */}
                <p className={styles.caveat}>
                  Machine transcript, not a record of speech. It can mishear, and silence is
                  indistinguishable from speech it failed to recognise.
                </p>
              </>
            ) : (
              <p className={styles.notice}>Listening…</p>
            )}
          </div>
        )}

        {state.state === "requesting-camera" && (
          <p className={styles.notice}>Waiting for camera permission…</p>
        )}

        {state.state === "unsupported" && <p className={styles.error}>{state.reason}</p>}
        {state.state === "denied" && <p className={styles.error}>{state.reason}</p>}

        {state.state === "idle" && (
          <p className={styles.notice}>
            Sends a frame every couple of seconds for hazard triage. The camera stops when this tab
            goes to the background or the screen locks.
          </p>
        )}

        {running && state.lastError && <p className={styles.error}>{state.lastError}</p>}

        {running && !state.lastResult && !state.lastError && (
          <p className={styles.notice}>Sending frames…</p>
        )}

        {running && state.lastResult && (
          <div className={styles.result}>
            <span className={styles.priority} data-level={state.lastResult.review_priority}>
              {state.lastResult.review_priority.replace(/_/g, " ")}
            </span>

            <p className={styles.summary}>
              {state.lastResult.assessment?.summary ?? "No assessment was returned."}
            </p>

            {state.lastResult.detections.length > 0 && (
              <p className={styles.detections}>
                {state.lastResult.detections
                  .slice(0, 6)
                  .map(
                    (detection) => `${detection.label} ${Math.round(detection.confidence * 100)}%`,
                  )
                  .join(" · ")}
              </p>
            )}

            {/* The service never clears a scene; it only ever asks for review. */}
            <p className={styles.caveat}>
              Model output for a person to review, not a decision. Confidence is an uncalibrated
              score, and an empty result does not mean the scene is safe.
            </p>
          </div>
        )}
      </section>
    </main>
  );
}
