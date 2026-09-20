"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { HeartPulse, Radio, Shield } from "lucide-react";
import { PEOPLE, type View } from "./scenario";
import type { Workspace } from "./workspace";
import officerStyles from "./OfficerWorkspace.module.css";
import styles from "./WorkspaceMapShell.module.css";

interface Props {
  workspace: Workspace | null;
  view: "command" | "hospital";
  onViewChange: (view: View) => void;
  selectedId: string;
  onSelect: (id: string) => void;
  status: string;
  map: ReactNode;
}

/** Presentation only. Role-specific workflows stay out until their layout is defined. */
export function WorkspaceMapShell({
  workspace,
  view,
  onViewChange,
  selectedId,
  onSelect,
  status,
  map,
}: Props) {
  const label = view === "command" ? "Dispatch" : "Medic";
  const RoleIcon = view === "command" ? Radio : HeartPulse;

  return (
    <div className={`paw-app ${officerStyles.officer} ${styles.shell}`}>
      <a className="skip-link" href="#workspace">
        Skip to workspace
      </a>
      <header className="topbar">
        <Link className="wordmark" href="/" aria-label="Paw Patrol home">
          <Shield />
          <span>Paw Patrol</span>
        </Link>
        <nav aria-label="Workspace">
          {workspace ? (
            <span className="nav-item active" aria-current="page">
              <RoleIcon aria-hidden="true" /> {label}
            </span>
          ) : (
            (["command", "officer", "hospital"] as const).map((role) => (
              <button
                key={role}
                className={`nav-item ${view === role ? "active" : ""}`}
                aria-pressed={view === role}
                onClick={() => onViewChange(role)}
              >
                {role === "command" ? (
                  <Radio aria-hidden="true" />
                ) : role === "officer" ? (
                  <Shield aria-hidden="true" />
                ) : (
                  <HeartPulse aria-hidden="true" />
                )}
                {role === "command" ? "Command" : role === "officer" ? "Officer" : "Hospital"}
              </button>
            ))
          )}
        </nav>
        <span aria-hidden="true" />
      </header>
      <main id="workspace">
        <h1 className="sr-only">{label} workspace</h1>
        {map}
        <div className={officerStyles.unitPicker}>
          <RoleIcon size={18} aria-hidden="true" />
          <label className="sr-only" htmlFor="workspace-person">
            Selected person
          </label>
          <select
            id="workspace-person"
            value={selectedId}
            onChange={(event) => onSelect(event.target.value)}
          >
            {PEOPLE.map((person) => (
              <option key={person.id} value={person.id}>
                {person.id} · {person.name}
              </option>
            ))}
          </select>
          <span>{status}</span>
        </div>
      </main>
    </div>
  );
}
