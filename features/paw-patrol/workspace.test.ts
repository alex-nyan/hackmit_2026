import { describe, expect, it } from "vitest";
import { parseWorkspace, workspaceConfig, WORKSPACE_VIEWS } from "./workspace";

describe("workspace configuration", () => {
  it("keeps the standalone demonstration available when no role is selected", () => {
    expect(workspaceConfig(undefined, undefined)).toEqual({ workspace: null, distDir: ".next" });
    expect(parseWorkspace("")).toBeNull();
  });

  it.each(["dispatch", "officer", "hospital"] as const)("isolates %s output", (workspace) => {
    expect(workspaceConfig(workspace, undefined)).toEqual({
      workspace,
      distDir: `.next-${workspace}`,
    });
    expect(workspaceConfig(workspace, `.next-${workspace}`).workspace).toBe(workspace);
  });

  it("maps dispatch to the existing command interface", () => {
    expect(WORKSPACE_VIEWS.dispatch).toBe("command");
  });

  it.each(["command", "admin", "toString", "__proto__", " hospital"])(
    "rejects invalid role %s",
    (workspace) => {
      expect(() => parseWorkspace(workspace)).toThrow("PAW_PATROL_WORKSPACE");
    },
  );

  it.each(["../build", "/tmp/output", ".next", ".next-hospital", ""])(
    "rejects unsafe or shared output %s",
    (distDir) => {
      expect(() => workspaceConfig("officer", distDir)).toThrow("PAW_PATROL_DIST_DIR");
    },
  );
});
