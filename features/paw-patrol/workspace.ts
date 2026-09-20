import type { View } from "./scenario";

export const WORKSPACE_VIEWS = {
  dispatch: "command",
  officer: "officer",
  hospital: "hospital",
} as const satisfies Record<string, View>;

export type Workspace = keyof typeof WORKSPACE_VIEWS;

export const WORKSPACE_LABELS: Record<Workspace, string> = {
  dispatch: "Dispatch",
  officer: "Officer",
  hospital: "Hospital",
};

export function parseWorkspace(value: string | undefined): Workspace | null {
  if (value === undefined || value === "") return null;
  if (Object.hasOwn(WORKSPACE_VIEWS, value)) return value as Workspace;
  throw new Error("PAW_PATROL_WORKSPACE must be dispatch, officer, or hospital.");
}

/**
 * Whether a server dedicated to one role should refuse another role's page.
 *
 * A role is pinned two ways now. `PAW_PATROL_WORKSPACE` dedicates a whole
 * server to one, which is what the three-port launcher does; a role route
 * pins one window on a server that is serving every role at once. The second
 * is what lets three separate dashboards share one incident log and one body
 * camera wall, because sharing needs a single process. Where a server has been
 * dedicated, the other roles' routes are not its to serve.
 */
export function pinnedElsewhere(workspace: Workspace, value: string | undefined): boolean {
  const pinned = parseWorkspace(value);
  return pinned !== null && pinned !== workspace;
}

export function workspaceConfig(
  workspaceValue: string | undefined,
  distDirValue: string | undefined,
) {
  const workspace = parseWorkspace(workspaceValue);
  const distDir = workspace ? `.next-${workspace}` : ".next";
  // Each role owns one build/cache directory. Reject paths outside the app and
  // accidental directory sharing instead of allowing concurrent Next processes
  // to overwrite one another's output.
  if (distDirValue !== undefined && distDirValue !== distDir) {
    throw new Error("PAW_PATROL_DIST_DIR must match the selected workspace's build directory.");
  }
  return { workspace, distDir };
}
