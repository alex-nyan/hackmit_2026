import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  demoReducer,
  initialDemo,
  useScenario,
  type DemoAction,
  type DemoState,
} from "../useScenario";
import { createScenarioClock } from "./scenarioClock";

function fixture(initialState = initialDemo) {
  let timestamp = 0;
  const clock = createScenarioClock<DemoState, DemoAction>({
    initialState,
    reduce: demoReducer,
    elapsedAction: (delta) => ({ type: "tick", delta }),
    now: () => timestamp,
  });
  return {
    ...clock,
    at: (milliseconds: number) => {
      timestamp = milliseconds;
    },
  };
}

describe("shared scenario clock", () => {
  it("reads continuous elapsed time without waiting for a UI tick", () => {
    const clock = fixture();
    clock.dispatch({ type: "play" });
    clock.at(16);
    expect(clock.read().time).toBeCloseTo(0.016);
    clock.at(32);
    expect(clock.read().time).toBeCloseTo(0.032);
    clock.at(250);
    expect(clock.read().time).toBeCloseTo(0.25);
  });

  it("materializes a control at its exact time and never rewinds on pause", () => {
    const clock = fixture();
    clock.dispatch({ type: "play" });
    clock.at(250);
    expect(clock.read().time).toBe(0.25);
    clock.at(412);
    expect(clock.dispatch({ type: "pause" }).time).toBeCloseTo(0.412);
    clock.at(5000);
    expect(clock.read().time).toBeCloseTo(0.412);
    clock.dispatch({ type: "play" });
    clock.at(5150);
    expect(clock.read().time).toBeCloseTo(0.562);
  });

  it("does not charge hidden time after the visibility handler pauses", () => {
    const clock = fixture();
    clock.dispatch({ type: "play" });
    clock.at(700);
    clock.dispatch({ type: "pause" });
    clock.at(60_700);
    clock.dispatch({ type: "play" });
    expect(clock.read().time).toBeCloseTo(0.7);
    clock.at(60_800);
    expect(clock.read().time).toBeCloseTo(0.8);
  });

  it("keeps patrol running beyond the former scene boundaries", () => {
    const clock = fixture({ ...initialDemo, time: 59.75, running: true });
    clock.at(300);
    expect(clock.read()).toMatchObject({ time: 60.05, running: true });
    clock.at(100000);
    expect(clock.read()).toMatchObject({ time: 159.75, running: true, panics: [], audit: [] });
  });
  it("materializes report timestamps from the same clock", () => {
    const clock = fixture({ ...initialDemo, time: 40, running: true });
    clock.at(155);
    const state = clock.dispatch({ type: "scene", status: "unsafe" });
    expect(state.sceneOverride?.at).toBeCloseTo(40.155);
    expect(state.audit[0].at).toBeCloseTo(state.time);
  });

  it("pauses an early panic at the exact current frame instead of seeking to the threat stage", () => {
    const clock = fixture({ ...initialDemo, running: true });
    clock.at(5321);
    const before = clock.read();
    const state = clock.dispatch({ type: "panic", personId: "P-02" });
    expect(state.time).toBe(before.time);
    expect(state.time).toBeCloseTo(5.321);
    expect(state.running).toBe(false);
    expect(state.panics[0].at).toBe(state.time);
    clock.at(10_000);
    expect(clock.read()).toBe(state);
    clock.dispatch({ type: "play" });
    clock.at(10_100);
    expect(clock.read().time).toBeCloseTo(5.421);
  });

  it("resets and restarts continuous patrol without stale time accumulation", () => {
    const clock = fixture({ ...initialDemo, time: 89, running: true });
    clock.at(2000);
    expect(clock.read()).toMatchObject({ time: 91, running: true });
    clock.at(10_000);
    expect(clock.dispatch({ type: "pause" }).time).toBe(99);
    clock.dispatch({ type: "reset" });
    clock.dispatch({ type: "play" });
    clock.at(10_500);
    expect(clock.read().time).toBe(0.5);
    clock.dispatch({ type: "reset" });
    clock.at(20_000);
    expect(clock.read()).toBe(initialDemo);
    clock.dispatch({ type: "play" });
    clock.at(20_200);
    expect(clock.read().time).toBeCloseTo(0.2);
  });

  it("treats forward seek as a time change without an incident stage", () => {
    const clock = fixture({ ...initialDemo, running: true });
    clock.at(1500);
    expect(clock.dispatch({ type: "next" }).time).toBe(16.5);
    clock.at(1700);
    expect(clock.read().time).toBeCloseTo(16.7);
  });

  it("ignores invalid or backwards monotonic samples", () => {
    const clock = fixture({ ...initialDemo, running: true });
    clock.at(1000);
    expect(clock.read().time).toBe(1);
    clock.at(500);
    expect(clock.read().time).toBe(1);
    clock.at(Number.NaN);
    expect(clock.read().time).toBe(1);
    clock.at(1200);
    expect(clock.read().time).toBeCloseTo(1.2);
  });
});

describe("scenario clock lifecycle", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("keeps a stable frame reader, throttles React snapshots and cleans its timer", () => {
    vi.useFakeTimers();
    let timestamp = 0;
    vi.spyOn(performance, "now").mockImplementation(() => timestamp);
    vi.spyOn(document, "hidden", "get").mockReturnValue(false);
    const remove = vi.spyOn(document, "removeEventListener");
    const hook = renderHook(() => useScenario());
    const read = hook.result.current.readClock;
    act(() => hook.result.current.dispatch({ type: "play" }));
    timestamp = 110;
    expect(read().time).toBeCloseTo(0.11);
    expect(hook.result.current.time).toBe(0);
    act(() => vi.advanceTimersByTime(250));
    expect(hook.result.current.time).toBeCloseTo(0.11);
    expect(hook.result.current.readClock).toBe(read);
    expect(vi.getTimerCount()).toBe(1);
    hook.unmount();
    expect(vi.getTimerCount()).toBe(0);
    expect(remove).toHaveBeenCalledWith("visibilitychange", expect.any(Function));
  });

  it("pauses when hidden and refuses a hidden play request", () => {
    vi.useFakeTimers();
    let timestamp = 0;
    let hidden = false;
    vi.spyOn(performance, "now").mockImplementation(() => timestamp);
    vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
    const hook = renderHook(() => useScenario());
    act(() => hook.result.current.dispatch({ type: "play" }));
    timestamp = 120;
    hidden = true;
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(hook.result.current).toMatchObject({ time: 0.12, running: false });
    expect(vi.getTimerCount()).toBe(0);
    timestamp = 50_120;
    act(() => hook.result.current.dispatch({ type: "play" }));
    expect(hook.result.current).toMatchObject({ time: 0.12, running: false });
    hidden = false;
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(hook.result.current.running).toBe(false);
    act(() => hook.result.current.dispatch({ type: "play" }));
    timestamp = 50_220;
    expect(hook.result.current.readClock().time).toBeCloseTo(0.22);
    hook.unmount();
  });
});
