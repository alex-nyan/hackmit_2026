"use client";

import { useState } from "react";

import styles from "./CameraTriageView.module.css";
import { useCameraTriage } from "./useCameraTriage";

export function CameraTriageView() {
  const [sourceId, setSourceId] = useState("unit-01");
  const { state, videoRef, start, stop } = useCameraTriage({ sourceId });
  const running = state.state === "running";
  const active = running || state.state === "requesting-camera";

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
            disabled={active}
          />
          <button
            type="button"
            className={styles.button}
            data-stop={active ? "true" : undefined}
            onClick={() => (active ? stop() : void start())}
          >
            {active ? "Stop" : "Start"}
          </button>
        </div>

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
