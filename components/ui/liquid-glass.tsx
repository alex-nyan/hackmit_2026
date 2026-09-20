"use client";

import { useId } from "react";
import styles from "./liquid-glass.module.css";

/** Decorative layers adapted from the supplied liquid-glass component.
 * The host keeps its semantic element, layout and interactions unchanged.
 */
export function GlassEffect() {
  const filterId = `glass-${useId().replace(/:/g, "")}`;
  return (
    <div className={styles.layers} aria-hidden="true" data-liquid-glass="">
      <svg className={styles.filter} width="0" height="0" focusable="false">
        <defs>
          <filter id={filterId} x="0%" y="0%" width="100%" height="100%">
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.008 0.025"
              numOctaves="1"
              seed="17"
              result="noise"
            />
            <feGaussianBlur in="noise" stdDeviation="3" result="softMap" />
            <feDisplacementMap
              in="SourceGraphic"
              in2="softMap"
              scale="10"
              xChannelSelector="R"
              yChannelSelector="G"
            />
          </filter>
        </defs>
      </svg>
      <span className={styles.refraction} style={{ filter: `url("#${filterId}")` }} />
      <span className={styles.tint} />
      <span className={styles.shine} />
    </div>
  );
}
