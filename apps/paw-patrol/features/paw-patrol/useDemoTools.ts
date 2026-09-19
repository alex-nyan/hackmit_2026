"use client";
import { useEffect, useRef, type Dispatch } from "react";
import { flushSync } from "react-dom";
import { PEOPLE, type View } from "./scenario";
import type { DemoAction } from "./useScenario";
interface Props {
  view: View;
  selectedId: string;
  time: number;
  running: boolean;
  setView: (view: View) => void;
  setSelectedId: (id: string) => void;
  dispatch: Dispatch<DemoAction>;
  reset: () => void;
  play: () => void;
}
interface Tool {
  name: string;
  description: string;
  inputSchema: object;
  annotations: { readOnlyHint: boolean };
  execute: (input: unknown) => unknown;
}
interface Context {
  registerTool: (
    tool: Tool,
    options: { signal: AbortSignal },
  ) => void | Promise<void>;
}
export function useDemoTools(props: Props) {
  const state = useRef(props);
  useEffect(() => {
    state.current = props;
  }, [props]);
  useEffect(() => {
    const context = (document as Document & { modelContext?: Context })
      .modelContext;
    if (!context?.registerTool) return;
    const abort = new AbortController();
    const settled = () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
    const tools: Tool[] = [
      {
        name: "read_paw_patrol_demo",
        description:
          "Read the visible frontend demonstration state. All data is synthetic.",
        inputSchema: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true },
        execute: () => {
          const s = state.current;
          return {
            view: s.view,
            person: s.selectedId,
            time: s.time,
            running: s.running,
            simulated: true,
          };
        },
      },
      {
        name: "control_paw_patrol_demo",
        description:
          "Control only the visible local simulation. Never contacts police or hospitals.",
        inputSchema: {
          type: "object",
          properties: { action: { enum: ["play", "pause", "reset", "next"] } },
          required: ["action"],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false },
        execute: async (input) => {
          const x = input as Record<string, unknown>;
          if (
            !x ||
            typeof x !== "object" ||
            Object.keys(x).length !== 1 ||
            !["play", "pause", "reset", "next"].includes(String(x.action))
          )
            throw new Error("Invalid demo action");
          flushSync(() => {
            if (x.action === "reset") state.current.reset();
            else if (x.action === "play") state.current.play();
            else state.current.dispatch({
              type: x.action as "play" | "pause" | "reset" | "next",
            });
          });
          await settled();
          return { time: state.current.time, running: state.current.running };
        },
      },
      {
        name: "navigate_paw_patrol_demo",
        description:
          "Select the visible Command, Officer or Hospital workspace and optionally a fictional officer.",
        inputSchema: {
          type: "object",
          properties: {
            view: { enum: ["command", "officer", "hospital"] },
            personId: { enum: PEOPLE.map((p) => p.id) },
          },
          required: ["view"],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false },
        execute: async (input) => {
          const x = input as Record<string, unknown>;
          if (
            !x ||
            typeof x !== "object" ||
            Object.keys(x).some((k) => !["view", "personId"].includes(k)) ||
            !["command", "officer", "hospital"].includes(String(x.view)) ||
            (x.personId !== undefined &&
              !PEOPLE.some((p) => p.id === x.personId))
          )
            throw new Error("Invalid workspace or person");
          flushSync(() => {
            state.current.setView(x.view as View);
            if (x.personId) state.current.setSelectedId(String(x.personId));
          });
          await settled();
          return { view: state.current.view, person: state.current.selectedId };
        },
      },
    ];
    for (const tool of tools) {
      try {
        void Promise.resolve(
          context.registerTool(tool, { signal: abort.signal }),
        ).catch(() => {});
      } catch {
        /* Optional browser capability. */
      }
    }
    return () => abort.abort();
  }, []);
}
