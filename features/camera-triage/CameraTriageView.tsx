"use client";

import { useState } from "react";

import type { Officer } from "@/features/access/roster";
import { BodyCamWall } from "@/features/body-cam";
import { useDevicePosition } from "@/features/live-track";

import { describeTranscript } from "./audio";
import styles from "./CameraTriageView.module.css";
import { hasLabels } from "./devices";
import { toSourceId } from "./frame";
import { useAudioTranscription } from "./useAudioTranscription";
import { useCameraTriage } from "./useCameraTriage";
import { useCaptureDevices } from "./useCaptureDevices";

/**
 * The capture page.
 *
 * `officer` is present once a roster is configured and somebody has signed
 * in, and then it, rather than a typed unit name, is what the camera, the
 * microphone and the position all publish under. Without a roster the page
 * keeps its free-text field, which is how it worked before sign-in existed.
 */
export function CameraTriageView({ officer }: { officer?: Officer } = {}) {
  const [typedId, setTypedId] = useState("unit-01");
  const sourceId = officer?.id ?? typedId;
  const { devices, cameraId, setCameraId, resolveDevices } = useCaptureDevices();
  const { state, videoRef, start, stop } = useCameraTriage({ sourceId });
  const audio = useAudioTranscription(sourceId);
  // Location is its own switch: a unit that turns the camera off to save
  // battery should still be findable, and somebody who will share a camera has
  // not thereby agreed to share where they are.
  // The map should name the officer, not the slot they signed into.
  const position = useDevicePosition(sourceId, officer?.name);
  const sharing = position.state.state === "requesting" || position.state.state === "publishing";
  const running = state.state === "running";
  const listening =
    audio.state.state === "recording" || audio.state.state === "requesting-microphone";
  const active = running || state.state === "requesting-camera";

  async function startCamera() {
    const chosen = await resolveDevices();
    await start(chosen.cameraId);
  }

  return (
    <main className={styles.root}>
      <div className={styles.stage}>
        <video ref={videoRef} className={styles.video} playsInline muted autoPlay />
      </div>

      <section className={styles.panel}>
        <div className={styles.row}>
          {officer ? (
            // Signed in: the identity is settled, so it is shown rather than
            // offered for editing.
            <span className={styles.identity}>
              <strong>{officer.name}</strong>
              <small>{officer.badge}</small>
            </span>
          ) : (
            <input
              className={styles.field}
              value={typedId}
              onChange={(event) => setTypedId(event.target.value)}
              placeholder="Unit name"
              aria-label="Unit name"
              disabled={active || listening}
            />
          )}
          <button
            type="button"
            className={styles.button}
            data-stop={active ? "true" : undefined}
            onClick={() => (active ? stop() : void startCamera())}
          >
            {active ? "Stop" : "Start"}
          </button>
        </div>

        {devices.cameras.length > 1 && hasLabels(devices.cameras) && (
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
          <button
            type="button"
            className={styles.secondary}
            data-on={sharing ? "true" : undefined}
            aria-pressed={sharing}
            onClick={() => (sharing ? position.stop() : position.start())}
          >
            {sharing ? "Stop sharing location" : "Share my location"}
          </button>
        </div>

        {position.state.state === "requesting" && (
          <p className={styles.notice}>Waiting for location permission…</p>
        )}

        {position.state.state === "unsupported" && (
          <p className={styles.error}>{position.state.reason}</p>
        )}
        {position.state.state === "denied" && (
          <p className={styles.error}>{position.state.reason}</p>
        )}

        {position.state.state === "publishing" && (
          <p className={position.state.lastError ? styles.error : styles.notice}>
            {position.state.lastError ??
              (position.state.lastFixAt
                ? `Publishing your position${
                    position.state.accuracyMeters === null
                      ? ""
                      : ` · ±${Math.round(position.state.accuracyMeters)} m`
                  }`
                : "Waiting for a first fix…")}
          </p>
        )}

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

        {running && state.deviceLabel && (
          <p className={styles.notice}>Live on {state.deviceLabel}</p>
        )}

        {/* No triage service behind this deployment. Worth saying once,
            plainly: the capture still works and still feeds the wall. */}
        {running && !state.triageConfigured && (
          <p className={styles.notice}>
            No hazard triage configured here. Frames are still publishing to the body camera wall.
          </p>
        )}

        {running && state.triageConfigured && !state.lastResult && !state.lastError && (
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

      {/* The other half of a two-way demo: this phone publishes its own view
          above and watches everybody else's here, so neither person has to
          open a dashboard to see the other. */}
      <BodyCamWall excludeSourceId={toSourceId(sourceId)} className={styles.wall} />
    </main>
  );
}
