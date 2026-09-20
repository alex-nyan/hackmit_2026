"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, HeartPulse, Radio, Shield } from "lucide-react";
import type { View } from "./scenario";
import { WorkspaceLink } from "./WorkspaceLink";
import styles from "./WorkspaceNav.module.css";

const ROLES = ["command", "officer", "hospital"] as const;

export const WORKSPACE_NAV_LABELS: Record<View, string> = {
  command: "Command centre",
  officer: "Officer",
  hospital: "Hospital",
};

const ICONS = {
  command: Radio,
  officer: Shield,
  hospital: HeartPulse,
} as const;

interface Props {
  view: View;
  /** Shared labels for the current workspace and its destinations. */
  labels: Record<View, string>;
  /** Pinned routes navigate through links rather than changing the fixed view. */
  pinnedLabel?: string | null;
  onSelect: (view: View) => void;
}

/** One workspace disclosure shared by the Command, Officer and Hospital headers. */
export function WorkspaceNav({ view, labels, pinnedLabel, onSelect }: Props) {
  const navRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const choicesId = useId();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !navRef.current?.contains(event.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open]);

  const CurrentIcon = ICONS[view];

  function close() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  return (
    <nav
      aria-label="Workspace"
      className={styles.navigation}
      ref={navRef}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className={styles.trigger}
        aria-expanded={open}
        aria-controls={choicesId}
        title="Switch workspace"
        onClick={() => setOpen((current) => !current)}
      >
        <CurrentIcon size={16} aria-hidden="true" />
        <span>{labels[view]}</span>
        <ChevronDown size={16} className={styles.chevron} aria-hidden="true" />
      </button>
      {open && (
        <div id={choicesId} className={styles.choices}>
          <span className={styles.label}>Switch workspace</span>
          {ROLES.map((role) => {
            const RoleIcon = ICONS[role];
            const current = role === view;
            const content = (
              <>
                <RoleIcon size={16} aria-hidden="true" />
                <span>{labels[role]}</span>
                {current && <span className={styles.current}>Current</span>}
              </>
            );
            return pinnedLabel && !current ? (
              <WorkspaceLink
                key={role}
                view={role}
                label={labels[role]}
                className={styles.choice}
                onClick={close}
              >
                {content}
              </WorkspaceLink>
            ) : (
              <button
                key={role}
                type="button"
                className={styles.choice}
                aria-current={current ? "page" : undefined}
                onClick={() => {
                  close();
                  if (!current) onSelect(role);
                }}
              >
                {content}
              </button>
            );
          })}
        </div>
      )}
    </nav>
  );
}
