"use client";

import { useEffect, useRef, useState } from "react";
import { Maximize2, Minimize2 } from "lucide-react";
import styles from "./MapFullscreenButton.module.css";

/** Expand the existing map card so its camera, selection and controls stay mounted. */
export function MapFullscreenButton() {
  const button = useRef<HTMLButtonElement>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const card = button.current?.closest("section");
    if (!card || !expanded) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    card.classList.add(styles.expanded);
    const close = () => {
      setExpanded(false);
      button.current?.focus({ preventScroll: true });
    };
    const onFullscreenChange = () => {
      if (!document.fullscreenElement) close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (document.fullscreenElement === card) void document.exitFullscreen().catch(close);
        else close();
      }
      if (event.key === "Tab") {
        const controls = Array.from(
          card.querySelectorAll<HTMLElement>(
            'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), [tabindex="0"]',
          ),
        ).filter((element) => element.getClientRects().length > 0);
        const first = controls[0];
        const last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      card.classList.remove(styles.expanded);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [expanded]);

  const toggle = async () => {
    const card = button.current?.closest("section");
    if (!card) return;
    if (expanded) {
      if (document.fullscreenElement === card) await document.exitFullscreen().catch(() => {});
      setExpanded(false);
      button.current?.focus({ preventScroll: true });
    } else {
      setExpanded(true);
      // Browsers without the Fullscreen API still get a viewport-sized map.
      if (card.requestFullscreen) await card.requestFullscreen().catch(() => {});
    }
  };

  return (
    <button
      ref={button}
      className={styles.button}
      type="button"
      onClick={() => void toggle()}
      aria-pressed={expanded}
      title={expanded ? "Exit fullscreen (Esc)" : "Expand map"}
    >
      {expanded ? (
        <Minimize2 size={16} aria-hidden="true" />
      ) : (
        <Maximize2 size={16} aria-hidden="true" />
      )}
      {expanded ? "Exit fullscreen" : "Fullscreen"}
    </button>
  );
}
