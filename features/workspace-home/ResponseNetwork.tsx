"use client";

import { useState } from "react";
import { ArrowRight, HeartPulse, Pause, Play, Radio, Shield } from "lucide-react";
import styles from "./WorkspaceHome.module.css";

export function ResponseNetwork() {
  const [paused, setPaused] = useState(false);
  return (
    <section
      className={styles.diagram}
      data-paused={paused}
      aria-label="Illustrated response network"
    >
      <div className={styles.diagramHeading}>
        <span>THE RESPONSE NETWORK</span>
        <div className={styles.networkControls}>
          <span>ILLUSTRATION</span>
          <button
            type="button"
            className={styles.motionControl}
            onClick={() => setPaused(!paused)}
            aria-label={
              paused ? "Play response network animation" : "Pause response network animation"
            }
          >
            {paused ? (
              <Play size={12} aria-hidden="true" />
            ) : (
              <Pause size={12} aria-hidden="true" />
            )}
            {paused ? "Play motion" : "Pause motion"}
          </button>
        </div>
      </div>
      <div
        className={styles.network}
        role="img"
        aria-label="Field observations and dispatch coordination converge into a shared picture before the hospital handoff. This animation is illustrative, not live data."
      >
        <svg
          className={styles.signalPaths}
          viewBox="0 0 500 310"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path className={styles.fieldPath} d="M 100 55 L 250 155" />
          <path className={styles.dispatchPath} d="M 400 65 L 250 155" />
          <path className={styles.hospitalPath} d="M 250 155 L 250 265" />
          <g className={styles.fieldSignal}>
            <circle r="4" />
          </g>
          <g className={styles.dispatchSignal}>
            <circle r="4" />
          </g>
          <g className={styles.hospitalSignal}>
            <circle r="4" />
          </g>
        </svg>
        <div className={styles.signalRing} aria-hidden="true" />
        <div className={styles.orbit} />
        <div className={styles.orbitInner} />
        <div className={styles.hub}>
          <Shield size={34} aria-hidden="true" />
          <strong>One shared picture</strong>
          <span>Connected response</span>
        </div>
        <div className={`${styles.node} ${styles.field}`}>
          <Shield size={20} aria-hidden="true" />
          <div>
            <strong>Field team</strong>
            <span>Observe &amp; share</span>
          </div>
        </div>
        <div className={`${styles.node} ${styles.dispatch}`}>
          <Radio size={20} aria-hidden="true" />
          <div>
            <strong>Dispatch</strong>
            <span>Review &amp; coordinate</span>
          </div>
        </div>
        <div className={`${styles.node} ${styles.hospital}`}>
          <HeartPulse size={20} aria-hidden="true" />
          <div>
            <strong>Hospital</strong>
            <span>Prepare &amp; receive</span>
          </div>
        </div>
      </div>
      <div className={styles.diagramFooter}>
        <span>FIELD OBSERVATION</span>
        <ArrowRight size={14} aria-hidden="true" />
        <span>HUMAN REVIEW</span>
        <ArrowRight size={14} aria-hidden="true" />
        <span>HANDOFF</span>
      </div>
    </section>
  );
}
