import { describe, expect, it } from "vitest";
import { applyCommand, createInstance, owns, publicInstance } from "./model";
import { instanceNamespace, transact, type AtomicStore } from "./store";

const now = 1_000_000;
const ready = () => createInstance("officer-one", "Alex", "secret-hash", now);
const active = () => applyCommand(ready(), { type: "start" }, now, 1);
const fix = {
  id: "7",
  name: "Phone",
  online: true,
  fix: {
    longitude: -71.1,
    latitude: 42.36,
    accuracyMeters: 12,
    speedKmh: null,
    headingDegrees: null,
    fixedAt: new Date(now).toISOString(),
    ageSeconds: 0,
    freshness: "live" as const,
  },
};

describe("shared instance lifecycle", () => {
  it("has stable identity and no synthetic inputs", () => {
    const i = publicInstance(active(), now);
    expect(i.displayName).toBe("Alex");
    expect(i.heart).toEqual([]);
    expect(i.gps).toBeNull();
    expect(Object.values(i.sources).every((s) => s.state === "unavailable")).toBe(true);
    expect(i.media.room).not.toContain("Alex");
  });
  it("rejects a wrong publisher and replaced identity", () => {
    expect(() => owns(ready(), "officer-one", "wrong")).toThrow();
    expect(() => owns(ready(), "old-id", "secret-hash")).toThrow();
  });
  it("rejects delayed updates without blocking independent GPS and heartbeat channels", () => {
    let state = applyCommand(active(), { type: "telemetry", sources: { camera: "live" } }, now, 10);
    expect(() =>
      applyCommand(state, { type: "telemetry", sources: { camera: "error" } }, now, 9),
    ).toThrow(/newer/);
    state = applyCommand(state, { type: "heartbeat" }, now, 2);
    expect(state.instance.revision).toBe(4);
  });
  it("marks all live inputs offline after 15 seconds, keeping sample time intact", () => {
    const state = applyCommand(
      active(),
      {
        type: "telemetry",
        heart: { bpm: 81, receivedAt: now },
        sources: { camera: "live", heart: "live" },
      },
      now,
      2,
    );
    expect(publicInstance(state, now + 14_999).lifecycle).toBe("broadcasting");
    const offline = publicInstance(state, now + 15_000);
    expect(offline.lifecycle).toBe("offline");
    expect(offline.sources.camera.state).toBe("stale");
    expect(offline.heart[0].receivedAt).toBe(now);
  });
  it("a heartbeat cannot freshen an old watch reading", () => {
    let state = applyCommand(
      active(),
      { type: "telemetry", heart: { bpm: 81, receivedAt: now }, sources: { heart: "live" } },
      now,
      2,
    );
    state = applyCommand(state, { type: "heartbeat" }, now + 31_000, 3);
    expect(publicInstance(state, now + 31_000).sources.heart.state).toBe("stale");
  });
  it("limits watch updates to one per second and retains only 60 seconds", () => {
    let state = active();
    for (let j = 0; j < 140; j++)
      state = applyCommand(
        state,
        { type: "telemetry", heart: { bpm: 80, receivedAt: now + j * 500 } },
        now + j * 500,
        j + 2,
      );
    expect(state.instance.heart.length).toBeLessThanOrEqual(60);
    expect(
      state.instance.heart.every(
        (s, index, all) => !index || s.receivedAt - all[index - 1].receivedAt >= 1000,
      ),
    ).toBe(true);
    expect(publicInstance(state, now + 140_000).heart).toEqual([]);
  });
  it("rejects samples from before Start, duplicate samples, and future timestamps", () => {
    let state = active();
    for (const [index, at] of [now - 1, now + 6000, now, now].entries())
      state = applyCommand(
        state,
        { type: "telemetry", heart: { bpm: 80, receivedAt: at } },
        now,
        index + 2,
      );
    expect(state.instance.heart).toEqual([{ bpm: 80, receivedAt: now }]);
  });
  it("preserves Traccar measurement time and accuracy and ages GPS by device time", () => {
    const state = applyCommand(active(), { type: "gps", deviceId: "7" }, now, 2, fix);
    const i = publicInstance(state, now + 91_000);
    expect(i.gps?.fix).toMatchObject({
      accuracyMeters: 12,
      fixedAt: fix.fix.fixedAt,
      ageSeconds: 91,
      freshness: "stale",
    });
    expect(publicInstance(state, now + 601_000).gps?.fix?.freshness).toBe("lost");
  });
  it("does not overwrite GPS with an older buffered fix or poll faster than five seconds", () => {
    let state = applyCommand(active(), { type: "gps", deviceId: "7" }, now, 2, fix);
    state = applyCommand(state, { type: "gps", deviceId: "7" }, now + 1000, 3, null);
    expect(state.instance.gps).toEqual(fix);
    state = applyCommand(state, { type: "gps", deviceId: "7" }, now + 5000, 4, {
      ...fix,
      fix: { ...fix.fix, fixedAt: new Date(now - 1000).toISOString() },
    });
    expect(state.instance.gps?.fix?.fixedAt).toBe(fix.fix.fixedAt);
  });
  it("medical assignment and scene clearance are independent; Stop clears assignment", () => {
    let state = applyCommand(active(), { type: "assignment", requested: true }, now);
    expect(state.instance.scene.status).toBe("unknown");
    state = applyCommand(state, { type: "scene", status: "unsafe" }, now);
    state = applyCommand(state, { type: "assignment", requested: false }, now);
    expect(state.instance.scene.status).toBe("unsafe");
    state = applyCommand(state, { type: "assignment", requested: true }, now);
    state = applyCommand(state, { type: "stop" }, now, 5);
    expect(state.instance.lifecycle).toBe("ended");
    expect(state.instance.hospitalRequested).toBe(false);
    expect(() => applyCommand(state, { type: "heartbeat" }, now, 6)).toThrow(/ended/);
  });
  it("expires after 24 hours even if the controller keeps sending heartbeats", () => {
    const state = active();
    const expires = state.instance.expiresAt;
    expect(() => applyCommand(state, { type: "heartbeat" }, expires, 5)).toThrow(/ended/);
    expect(publicInstance(state, expires).lifecycle).toBe("ended");
  });
});

describe("atomic store", () => {
  it("retries concurrent mutations without losing a revision", async () => {
    let value: string | null = JSON.stringify(active());
    const ttls: number[] = [];
    const store: AtomicStore = {
      read: async () => value,
      compareAndSet: async (old, next, ttl) => {
        if (value !== old) return false;
        value = next;
        ttls.push(ttl);
        return true;
      },
    };
    await Promise.all([
      transact(store, (s) => applyCommand(s!, { type: "assignment", requested: true }, now), now),
      transact(store, (s) => applyCommand(s!, { type: "scene", status: "unsafe" }, now), now),
    ]);
    const state = JSON.parse(value!);
    expect(state.instance.revision).toBe(4);
    expect(state.instance.hospitalRequested).toBe(true);
    expect(state.instance.scene.status).toBe("unsafe");
    expect(ttls).toEqual([86400, 86400]);
  });
  it("fails closed after bounded CAS contention", async () => {
    const store: AtomicStore = { read: async () => null, compareAndSet: async () => false };
    await expect(transact(store, ready, now)).rejects.toThrow(/changed/);
  });
  it("isolates production, preview branches, and local namespaces", () => {
    const env = { INSTANCE_NAMESPACE: "demo", VERCEL_ENV: "production" };
    const production = instanceNamespace(env);
    expect(
      instanceNamespace({ ...env, VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "feature" }),
    ).not.toBe(production);
    expect(instanceNamespace({ INSTANCE_NAMESPACE: "demo" })).not.toBe(production);
    expect(() => instanceNamespace({})).toThrow(/NAMESPACE/);
  });
});
