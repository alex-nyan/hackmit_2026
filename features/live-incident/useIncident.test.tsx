import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useIncident } from "./useIncident";

class FakeEvents {
  static instances: FakeEvents[] = [];
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  listeners = new Map<string, (event: MessageEvent) => void>();
  closed = false;
  constructor(readonly url: string) {
    FakeEvents.instances.push(this);
  }
  addEventListener(name: string, callback: (event: MessageEvent) => void) {
    this.listeners.set(name, callback);
  }
  close() {
    this.closed = true;
  }
  emit(name: string, data = {}) {
    this.listeners.get(name)?.(new MessageEvent(name, { data: JSON.stringify(data) }));
  }
}
const snapshot = (revision = 1, incident_id = "case-1") => ({
  schema_version: "2.0",
  incident_id,
  revision,
  generated_at: "2026-09-19T20:00:00Z",
  sources: [],
  observations: [],
  alerts: [],
  scene_reports: [],
  patients: [],
  handoffs: [],
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  FakeEvents.instances = [];
});
describe("live incident connection", () => {
  it("recovers from a transient snapshot failure while the event stream remains open", async () => {
    let failNext = false;
    vi.stubGlobal("EventSource", FakeEvents);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => {
        if (failNext) {
          failNext = false;
          return new Response(null, { status: 503 });
        }
        return Response.json(snapshot());
      }),
    );
    const { result } = renderHook(() => useIncident("case-1"));
    await waitFor(() => expect(FakeEvents.instances).toHaveLength(1));
    act(() => FakeEvents.instances[0].onopen?.());
    await waitFor(() => expect(result.current.connection).toBe("connected"));
    const event = {
      schema_version: "2.0",
      event_id: "2",
      incident_id: "case-1",
      revision: 2,
      kind: "telemetry",
      recorded_at: "2026-09-19T20:00:01Z",
    };
    failNext = true;
    act(() => FakeEvents.instances[0].emit("incident", event));
    await waitFor(() => expect(result.current.connection).toBe("disconnected"));
    act(() => FakeEvents.instances[0].emit("incident", event));
    await waitFor(() => expect(result.current.connection).toBe("connected"));
  });
  it("rejects a snapshot from a different incident", async () => {
    vi.stubGlobal("EventSource", FakeEvents);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => Response.json(snapshot(1, "other"))),
    );
    const { result } = renderHook(() => useIncident("case-1"));
    await waitFor(() => expect(result.current.connection).toBe("disconnected"));
    expect(result.current.snapshot).toBeNull();
    expect(FakeEvents.instances).toHaveLength(0);
  });
  it("recreates an expired event cursor after obtaining a fresh snapshot", async () => {
    let revision = 1;
    vi.stubGlobal("EventSource", FakeEvents);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => Response.json(snapshot(revision))),
    );
    const { result } = renderHook(() => useIncident("case-1"));
    await waitFor(() => expect(FakeEvents.instances).toHaveLength(1));
    expect(FakeEvents.instances[0].url).toContain("after=1");
    revision = 50;
    act(() => FakeEvents.instances[0].emit("resync_required"));
    await waitFor(() => expect(FakeEvents.instances).toHaveLength(2));
    expect(FakeEvents.instances[0].closed).toBe(true);
    expect(FakeEvents.instances[1].url).toContain("after=50");
    expect(result.current.snapshot?.revision).toBe(50);
  });
  it("clears sensitive state if authorization is revoked", async () => {
    let allowed = true;
    vi.stubGlobal("EventSource", FakeEvents);
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockImplementation(async () =>
          allowed ? Response.json(snapshot()) : new Response(null, { status: 403 }),
        ),
    );
    const { result } = renderHook(() => useIncident("case-1"));
    await waitFor(() => expect(result.current.snapshot).not.toBeNull());
    allowed = false;
    act(() =>
      FakeEvents.instances[0].emit("incident", {
        schema_version: "2.0",
        event_id: "2",
        incident_id: "case-1",
        revision: 2,
        kind: "telemetry",
        recorded_at: "2026-09-19T20:00:01Z",
      }),
    );
    await waitFor(() => expect(result.current.connection).toBe("unauthorized"));
    expect(result.current.snapshot).toBeNull();
    expect(FakeEvents.instances[0].closed).toBe(true);
  });
  it("reuses the idempotency key after an uncertain assistance response", async () => {
    const keys: string[] = [];
    vi.stubGlobal("EventSource", FakeEvents);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (_url: string, init: RequestInit = {}) => {
        if (init.method !== "POST") return Response.json(snapshot());
        keys.push(new Headers(init.headers).get("idempotency-key") ?? "");
        if (keys.length === 1) throw new Error("Connection lost after submission");
        return Response.json({
          schema_version: "2.0",
          incident_id: "case-1",
          command_id: "cmd-1",
          revision: 2,
          alert_id: "alert-1",
          report_id: null,
          handoff_id: null,
        });
      }),
    );
    const { result } = renderHook(() => useIncident("case-1"));
    await waitFor(() => expect(result.current.snapshot).not.toBeNull());
    await act(async () => {
      expect(await result.current.command({ kind: "assistance", note: "Help requested" })).toBe(
        false,
      );
    });
    await act(async () => {
      expect(await result.current.command({ kind: "assistance", note: "Help requested" })).toBe(
        true,
      );
    });
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBeTruthy();
    expect(keys[1]).toBe(keys[0]);
  });
  it("retains separate retry IDs when another command intervenes", async () => {
    const keys: string[] = [];
    vi.stubGlobal("EventSource", FakeEvents);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (_url: string, init: RequestInit = {}) => {
        if (init.method !== "POST") return Response.json(snapshot());
        keys.push(new Headers(init.headers).get("idempotency-key") ?? "");
        if (keys.length === 1) throw new Error("uncertain receipt");
        return Response.json({
          schema_version: "2.0",
          incident_id: "case-1",
          command_id: "cmd-1",
          revision: 2,
          alert_id: "a",
          report_id: null,
          handoff_id: null,
        });
      }),
    );
    const { result } = renderHook(() => useIncident("case-1"));
    await waitFor(() => expect(result.current.snapshot).not.toBeNull());
    await act(async () => {
      await result.current.command({ kind: "assistance", note: "First" });
    });
    await act(async () => {
      await result.current.command({ kind: "assistance", note: "Second" });
    });
    await act(async () => {
      await result.current.command({ kind: "assistance", note: "First" });
    });
    expect(keys[2]).toBe(keys[0]);
    expect(keys[1]).not.toBe(keys[0]);
  });
});

it("replays the original scene-report body and key after an uncertain commit advances the snapshot", async () => {
  let revision = 1;
  const requests: { body: string; key: string }[] = [];
  vi.stubGlobal("EventSource", FakeEvents);
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(async (_url: string, init: RequestInit = {}) => {
      if (init.method !== "POST") return Response.json(snapshot(revision));
      requests.push({
        body: String(init.body),
        key: new Headers(init.headers).get("idempotency-key") ?? "",
      });
      if (requests.length === 1) {
        revision = 2; // The server committed the action before its receipt was lost.
        throw new Error("response lost after commit");
      }
      return Response.json({
        schema_version: "2.0",
        incident_id: "case-1",
        command_id: "cmd-1",
        revision: 2,
        alert_id: null,
        report_id: "report-1",
        handoff_id: null,
      });
    }),
  );
  const { result } = renderHook(() => useIncident("case-1"));
  await waitFor(() => expect(FakeEvents.instances).toHaveLength(1));
  await act(async () => {
    expect(
      await result.current.command({
        kind: "scene_report",
        expected_revision: 1,
        status: "restricted",
        scope: "North entry",
        note: "Reported blockage",
        valid_for_seconds: 300,
      }),
    ).toBe(false);
  });
  act(() =>
    FakeEvents.instances[0].emit("incident", {
      schema_version: "2.0",
      event_id: "2",
      incident_id: "case-1",
      revision: 2,
      kind: "scene_reported",
      recorded_at: "2026-09-19T20:00:01Z",
    }),
  );
  await waitFor(() => expect(result.current.snapshot?.revision).toBe(2));
  await act(async () => {
    // Property order and automatic revision updates are not a new human intent.
    expect(
      await result.current.command({
        scope: "North entry",
        kind: "scene_report",
        expected_revision: 2,
        valid_for_seconds: 300,
        note: "Reported blockage",
        status: "restricted",
      }),
    ).toBe(true);
  });
  expect(requests[1]).toEqual(requests[0]);
  expect(JSON.parse(requests[1].body).expected_revision).toBe(1);
});

it("uses a new request only after a definite rejection of an uncommitted intent", async () => {
  const requests: { body: string; key: string }[] = [];
  vi.stubGlobal("EventSource", FakeEvents);
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(async (_url: string, init: RequestInit = {}) => {
      if (init.method !== "POST") return Response.json(snapshot(2));
      requests.push({
        body: String(init.body),
        key: new Headers(init.headers).get("idempotency-key") ?? "",
      });
      if (requests.length === 1) return new Response(null, { status: 409 });
      return Response.json({
        schema_version: "2.0",
        incident_id: "case-1",
        command_id: "cmd-2",
        revision: 3,
        alert_id: "alert-1",
        report_id: null,
        handoff_id: null,
      });
    }),
  );
  const { result } = renderHook(() => useIncident("case-1"));
  await waitFor(() => expect(result.current.snapshot?.revision).toBe(2));
  await act(async () => {
    expect(
      await result.current.command({
        kind: "acknowledge",
        expected_revision: 1,
        alert_id: "alert-1",
      }),
    ).toBe(false);
  });
  await act(async () => {
    expect(
      await result.current.command({
        kind: "acknowledge",
        expected_revision: 2,
        alert_id: "alert-1",
      }),
    ).toBe(true);
  });
  expect(requests[1].key).not.toBe(requests[0].key);
  expect(JSON.parse(requests[1].body).expected_revision).toBe(2);
});
