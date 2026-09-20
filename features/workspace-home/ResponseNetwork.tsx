"use client";

import { useState } from "react";
import { HeartPulse, Pause, Play, Radio, Shield } from "lucide-react";
import { BrandLogo } from "@/components/BrandLogo";
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
        <div className={styles.screenBrand}>
          <BrandLogo size={28} />
          <span>Paw Patrol</span>
        </div>
        <div className={styles.networkControls}>
          <span>Illustration</span>
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
          <BrandLogo size={64} />
          <strong>One shared picture</strong>
        </div>
        <div className={`${styles.node} ${styles.field}`}>
          <Shield size={20} aria-hidden="true" />
          <div>
            <strong>Field team</strong>
          </div>
        </div>
        <div className={`${styles.node} ${styles.dispatch}`}>
          <Radio size={20} aria-hidden="true" />
          <div>
            <strong>Dispatch</strong>
          </div>
        </div>
        <div className={`${styles.node} ${styles.hospital}`}>
          <HeartPulse size={20} aria-hidden="true" />
          <div>
            <strong>Hospital</strong>
          </div>
        </div>
      </div>
    </section>
  );
}
