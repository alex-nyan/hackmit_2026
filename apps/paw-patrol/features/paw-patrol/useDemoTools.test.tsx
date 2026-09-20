import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDemoTools } from "./useDemoTools";
import type { View } from "./scenario";

type RegisteredTool = {
  name: string;
  inputSchema: { properties: { view?: { enum: View[] } } };
  execute: (input: unknown) => unknown;
};
const tools = new Map<string, RegisteredTool>();
const signals: AbortSignal[] = [];

beforeEach(() => {
  tools.clear();
  signals.length = 0;
  Object.defineProperty(document, "modelContext", {
    configurable: true,
    value: {
      registerTool: (tool: RegisteredTool, { signal }: { signal: AbortSignal }) => {
        tools.set(tool.name, tool);
        signals.push(signal);
      },
    },
  });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callback(0); return 1; });
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(document, "modelContext");
  vi.unstubAllGlobals();
});

function mount(fixedView?: View) {
  const props = {
    view: fixedView ?? "command" as View,
    fixedView,
    selectedId: "P-01",
    time: 0,
    running: false,
    setView: vi.fn(),
    setSelectedId: vi.fn(),
    dispatch: vi.fn(),
    reset: vi.fn(),
    play: vi.fn(),
  };
  const hook = renderHook(() => useDemoTools(props));
  return { ...hook, props, navigation: tools.get("navigate_paw_patrol_demo")! };
}

describe("workspace-aware demo tools", () => {
  it.each(["command", "officer", "hospital"] as const)("rejects switching away from fixed %s before changing any state", async (fixedView) => {
    const { props, navigation } = mount(fixedView);
    expect(navigation.inputSchema.properties.view?.enum).toEqual([fixedView]);
    const otherView = fixedView === "hospital" ? "officer" : "hospital";
    await expect(navigation.execute({ view: otherView, personId: "P-02" })).rejects.toThrow("fixed workspace");
    expect(props.setView).not.toHaveBeenCalled();
    expect(props.setSelectedId).not.toHaveBeenCalled();
    expect(tools.get("read_paw_patrol_demo")!.execute({})).toMatchObject({ workspaceLocked: true, view: fixedView });
  });

  it("allows selecting another officer within the fixed dispatch workspace", async () => {
    const { props, navigation } = mount("command");
    await navigation.execute({ view: "command", personId: "P-02" });
    expect(props.setSelectedId).toHaveBeenCalledWith("P-02");
    expect(props.setView).toHaveBeenCalledWith("command");
  });

  it("retains standalone navigation and unregisters tools on unmount", async () => {
    const { props, navigation, unmount } = mount();
    await navigation.execute({ view: "hospital", personId: "P-02" });
    expect(props.setView).toHaveBeenCalledWith("hospital");
    expect(props.setSelectedId).toHaveBeenCalledWith("P-02");
    expect(tools.get("read_paw_patrol_demo")!.execute({})).toMatchObject({ workspaceLocked: false });
    unmount();
    expect(signals.every(signal => signal.aborted)).toBe(true);
  });
});
