"use client";

import { createContext, useContext, useSyncExternalStore, type ReactNode } from "react";
import type { View } from "./scenario";
import { WORKSPACE_VIEWS, type Workspace } from "./workspace";

interface NavigationConfig {
  dedicatedWorkspace: Workspace | null;
  officerSignIn: boolean;
  localDevelopment: boolean;
}
const NavigationContext = createContext<NavigationConfig>({
  dedicatedWorkspace: null,
  officerSignIn: false,
  localDevelopment: false,
});

export function WorkspaceNavigationProvider({
  children,
  ...config
}: NavigationConfig & { children: ReactNode }) {
  return <NavigationContext value={config}>{children}</NavigationContext>;
}

const subscribe = () => () => {};
const origin = () => window.location.origin;
const serverOrigin = () => "";
const routes: Record<View, string> = {
  command: "/dispatch",
  officer: "/officer",
  hospital: "/hospital",
};

export function workspaceHref(
  view: View,
  currentOrigin: string,
  config: NavigationConfig,
): string | null {
  if (
    config.dedicatedWorkspace === null ||
    WORKSPACE_VIEWS[config.dedicatedWorkspace] === view ||
    (view === "officer" && config.officerSignIn)
  ) {
    return routes[view];
  }
  if (!config.localDevelopment || !currentOrigin) return null;
  const url = new URL(currentOrigin);
  // Separate local development workspaces use the launcher's fixed ports.
  // Each destination service still needs to be running.
  if (
    ["localhost", "127.0.0.1"].includes(url.hostname) &&
    ["5176", "5177", "5178"].includes(url.port)
  ) {
    url.port = { command: "5176", officer: "5177", hospital: "5178" }[view];
    url.pathname = routes[view];
    return url.href;
  }
  return null;
}

/** Keep the current workspace alive: it may be publishing an ambulance handoff. */
export function WorkspaceLink({
  view,
  label,
  children,
  className,
  onClick,
}: {
  view: View;
  label: string;
  children: ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  const currentOrigin = useSyncExternalStore(subscribe, origin, serverOrigin);
  const config = useContext(NavigationContext);
  const href = workspaceHref(view, currentOrigin, config);
  if (href === null) {
    return (
      <button
        type="button"
        disabled
        className={className}
        title="Not served by this dedicated workspace"
        aria-label={`${label} unavailable: not served by this dedicated workspace`}
      >
        {children}
      </button>
    );
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
      aria-label={`${label} (opens in new tab)`}
      title={`${label} (opens in new tab)`}
      onClick={onClick}
    >
      {children}
    </a>
  );
}
