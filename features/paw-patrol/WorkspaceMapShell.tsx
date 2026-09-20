"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { HeartPulse, Radio } from "lucide-react";
import { BrandLogo } from "@/components/BrandLogo";
import { PEOPLE, type View } from "./scenario";
import type { Workspace } from "./workspace";
import officerStyles from "./OfficerWorkspace.module.css";
import styles from "./WorkspaceMapShell.module.css";
import { WorkspaceNav } from "./WorkspaceNav";

const NAV_LABELS: Record<View, string> = {
  command: "Command",
  officer: "Officer",
  hospital: "Hospital",
};

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
          <BrandLogo size={40} />
          <span>Paw Patrol</span>
        </Link>
        <WorkspaceNav
          view={view}
          labels={NAV_LABELS}
          pinnedLabel={workspace ? label : null}
          onSelect={onViewChange}
        />
        <Link href="/sign-in" className="hardware-toggle">
          Officer sign-in
        </Link>
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
