"use client";

import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { HeartPulse, Radio, Shield } from "lucide-react";
import type { View } from "./scenario";

const ROLES = ["command", "officer", "hospital"] as const;

const ICONS = {
  command: Radio,
  officer: Shield,
  hospital: HeartPulse,
} as const;

interface Props {
  view: View;
  /** Tab labels, so Dispatch can read as "Command" where that is the clearer word. */
  labels: Record<View, string>;
  /** Set when the window is pinned to one role: that role shows alone, unswitchable. */
  pinnedLabel?: string | null;
  onSelect: (view: View) => void;
}

/**
 * The workspace tabs, shared by every dashboard header.
 *
 * The selected tab is drawn by one pill element that slides between tabs
 * rather than by a background on each tab, so switching roles reads as one
 * object moving. The pill is measured from the live layout because the tabs
 * are text-width, and text width is not knowable up front.
 */
export function WorkspaceNav({ view, labels, pinnedLabel, onSelect }: Props) {
  const navRef = useRef<HTMLElement>(null);
  const [pill, setPill] = useState({ x: 0, w: 0, ready: false });

  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const measure = () => {
      const active = nav.querySelector<HTMLElement>(".nav-item.active");
      if (!active || active.offsetWidth === 0) return;
      setPill({ x: active.offsetLeft, w: active.offsetWidth, ready: true });
    };
    measure();
    // Fonts and responsive padding change tab widths after first paint.
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(nav);
    return () => observer.disconnect();
  }, [view, pinnedLabel, labels]);

  const PinnedIcon = ICONS[view];

  return (
    <nav aria-label="Workspace" ref={navRef}>
      <span
        className="nav-pill"
        aria-hidden="true"
        data-ready={pill.ready}
        style={{ "--pill-x": `${pill.x}px`, "--pill-w": `${pill.w}px` } as CSSProperties}
      />
      {pinnedLabel ? (
        <span className="nav-item active" aria-current="page">
          <PinnedIcon aria-hidden="true" />
          {pinnedLabel}
        </span>
      ) : (
        ROLES.map((role) => {
          const RoleIcon = ICONS[role];
          return (
            <button
              key={role}
              className={`nav-item ${view === role ? "active" : ""}`}
              aria-pressed={view === role}
              onClick={() => onSelect(role)}
            >
              <RoleIcon aria-hidden="true" />
              {labels[role]}
            </button>
          );
        })
      )}
    </nav>
  );
}
