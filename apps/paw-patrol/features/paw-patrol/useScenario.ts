"use client";
import { useCallback, useEffect, useState } from "react";
import { clampTime, DURATION, nextTime } from "./scenario";
import { isPersonId, sceneAt, type SceneReport, type SceneStatus, type PanicReport, type ConsultEvent } from "./consult";
import { createScenarioClock } from "./vehicles/scenarioClock";
export type DemoState = { time: number; running: boolean; sceneOverride: SceneReport | null; panics: PanicReport[]; audit: ConsultEvent[] };
export type DemoAction =
  | { type: "tick"; delta: number }
  | { type: "scene"; status: SceneStatus }
  | { type: "panic" | "acknowledge"; personId: string }
  | { type: "play" | "pause" | "reset" | "next" };
export const initialDemo: DemoState = { time: 0, running: false, sceneOverride: null, panics: [], audit: [] };
function advance(state: DemoState, target: number): DemoState {
  // A clock jump may not bypass staging. Default playback contains a distinct,
  // explicitly scripted command clearance at 00:56; manual reports override it.
  const blocked = state.time < 60 && target >= 60 && sceneAt(target, state.sceneOverride).status !== "cleared";
  const time = blocked ? Math.max(state.time, 59) : clampTime(target);
  return { ...state, time, running: state.running && !blocked && time < DURATION };
}
export function demoReducer(state: DemoState, action: DemoAction): DemoState {
  switch (action.type) {
    case "play":
      return state.time === DURATION ? { ...initialDemo, running: true } : { ...state, running: true };
    case "pause":
      return { ...state, running: false };
    case "reset":
      return initialDemo;
    case "next": {
      const time = nextTime(state.time);
      return advance(state, time);
    }
    case "tick": {
      if (!state.running || !Number.isFinite(action.delta) || action.delta < 0)
        return state;
      return advance(state, state.time + action.delta);
    }
    case "scene": {
      // Once transport has departed, preserve that historical clearance.
      if (state.time >= 60 || (action.status === "cleared" && state.time < 15)) return state;
      const sceneOverride: SceneReport = { status: action.status, at: state.time, source: "Demo operator" };
      return { ...state, sceneOverride, audit: [...state.audit, { id: `scene-${state.audit.length}`, at: state.time, title: `Scene ${action.status === "cleared" ? "clearance reported" : action.status}`, detail: action.status === "cleared" ? "Demo command authorizes EMS access. No real scene assessment performed." : "EMS must stage outside the incident until a clearance report is recorded.", source: "Demo operator" }] };
    }
    case "panic": {
      if (!isPersonId(action.personId) || state.time >= 60 || state.panics.some(p => p.personId === action.personId)) return state;
      // An assistance request is not a timeline seek. Preserve the current
      // positions rather than jumping every unit to the scripted threat stage.
      const time = state.time;
      return { ...state, time, running: false, sceneOverride: { status: "unsafe", at: time, source: "Demo operator" }, panics: [...state.panics, { personId: action.personId, at: time, acknowledgedAt: null }], audit: [...state.audit, { id: `panic-${action.personId}`, at: time, title: `Panic alert · ${action.personId}`, detail: "Manual assistance request. Injury and clinical condition are not inferred. Demo paused for scene review.", source: "Demo panic button" }] };
    }
    case "acknowledge": {
      if (!state.panics.some(p => p.personId === action.personId && p.acknowledgedAt === null)) return state;
      return { ...state, panics: state.panics.map(p => p.personId === action.personId ? { ...p, acknowledgedAt: state.time } : p), audit: [...state.audit, { id: `ack-${action.personId}`, at: state.time, title: `Panic acknowledged · ${action.personId}`, detail: "Command acknowledged the assistance request. Scene access is still governed separately.", source: "Demo operator" }] };
    }
  }
}
export function useScenario() {
  const [clock] = useState(() => createScenarioClock<DemoState, DemoAction>({
    initialState: initialDemo,
    reduce: demoReducer,
    elapsedAction: delta => ({ type: "tick", delta }),
  }));
  const [state, setState] = useState(initialDemo);
  const dispatch = useCallback((action: DemoAction) => {
    let next = clock.dispatch(action);
    // A control/tool cannot start background playback while the tab is hidden.
    if (next.running && document.hidden) next = clock.dispatch({ type: "pause" });
    setState(next);
  }, [clock]);

  useEffect(() => {
    const visibility = () => {
      if (document.hidden) dispatch({ type: "pause" });
    };
    document.addEventListener("visibilitychange", visibility);
    return () => document.removeEventListener("visibilitychange", visibility);
  }, [dispatch]);

  useEffect(() => {
    if (!state.running) return;
    // The vehicle layer reads this same clock each animation frame; React only
    // receives a snapshot four times per second for labels and event panels.
    const timer = setInterval(() => setState(clock.read()), 250);
    return () => clearInterval(timer);
  }, [clock, state.running]);

  return { ...state, dispatch, readClock: clock.read };
}
