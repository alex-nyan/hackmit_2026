import { StrictMode, type ReactNode } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useHeartRate } from "./useHeartRate";
import type { HeartRateCharacteristic, HeartRateDevice, HeartRateGattServer } from "./bluetooth";

class Measurement extends EventTarget implements HeartRateCharacteristic {
  value?: DataView;
  startNotifications = vi.fn(async () => this);
  stopNotifications = vi.fn(async () => this);
  send(...bytes: number[]) {
    this.value = new DataView(Uint8Array.from(bytes).buffer);
    this.dispatchEvent(new Event("characteristicvaluechanged"));
  }
}

function deviceFixture() {
  const measurement = new Measurement();
  const characteristic = vi.fn(async () => measurement);
  const device = new EventTarget() as HeartRateDevice;
  const server: HeartRateGattServer = {
    connected: false,
    connect: vi.fn(async () => { Object.assign(server, { connected: true }); return server; }),
    disconnect: vi.fn(() => {
      Object.assign(server, { connected: false });
      device.dispatchEvent(new Event("gattserverdisconnected"));
    }),
    getPrimaryService: vi.fn(async () => ({ getCharacteristic: characteristic })),
  };
  Object.assign(device, { name: "HeartCast", gatt: server });
  return { measurement, device, server, characteristic };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

let fixture: ReturnType<typeof deviceFixture>;
let requestDevice: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-20T02:00:00Z"));
  vi.stubGlobal("isSecureContext", true);
  fixture = deviceFixture();
  requestDevice = vi.fn(async () => fixture.device);
  Object.defineProperty(navigator, "bluetooth", { configurable: true, value: { requestDevice } });
});
afterEach(() => {
  cleanup();
  Reflect.deleteProperty(navigator, "bluetooth");
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const mount = () => renderHook(({ personId, resetKey }) => useHeartRate(personId, resetKey), {
  initialProps: { personId: "P-01", resetKey: 0 },
});

describe("useHeartRate", () => {
  it("starts in demo mode and never requests Bluetooth without an explicit connection", () => {
    const { result } = mount();
    expect(result.current).toMatchObject({ mode: "demo", bpm: null, status: "idle", supported: true });
    expect(requestDevice).not.toHaveBeenCalled();
  });

  it.each(["missing", "insecure"])("handles %s Web Bluetooth without opening a picker", async kind => {
    if (kind === "missing") Reflect.deleteProperty(navigator, "bluetooth");
    else vi.stubGlobal("isSecureContext", false);
    const { result } = mount();
    await act(() => result.current.connect());
    expect(result.current).toMatchObject({ mode: "device", status: "unsupported", supported: false, bpm: null });
    expect(requestDevice).not.toHaveBeenCalled();
  });

  it("reads notifications, receipt timestamps and bounded in-memory history", async () => {
    const { result } = mount();
    await act(() => result.current.connect());
    expect(requestDevice).toHaveBeenCalledWith({ filters: [{ services: ["heart_rate"] }] });
    expect(fixture.server.getPrimaryService).toHaveBeenCalledWith("heart_rate");
    expect(fixture.characteristic).toHaveBeenCalledWith("heart_rate_measurement");
    expect(result.current).toMatchObject({ mode: "device", status: "waiting", deviceName: "HeartCast" });
    act(() => fixture.measurement.send(0, 72));
    expect(result.current).toMatchObject({ status: "receiving", bpm: 72, receivedAt: Date.now() });
    act(() => { for (let i = 0; i < 70; i++) fixture.measurement.send(0, 80); });
    expect(result.current.history).toHaveLength(60);
    expect(result.current.history[0]).toEqual({ bpm: 80, receivedAt: Date.now() });
  });

  it("retains a notification that arrives before startNotifications resolves", async () => {
    fixture.measurement.startNotifications.mockImplementation(async () => {
      fixture.measurement.send(1, 44, 1);
      return fixture.measurement;
    });
    const { result } = mount();
    await act(() => result.current.connect());
    expect(result.current).toMatchObject({ status: "receiving", bpm: 300 });
  });

  it("marks data stale after 30 seconds and resumes on a new sample", async () => {
    const { result } = mount();
    await act(() => result.current.connect());
    act(() => fixture.measurement.send(0, 72));
    const receivedAt = result.current.receivedAt;
    act(() => vi.advanceTimersByTime(30_000));
    expect(result.current).toMatchObject({ status: "stale", bpm: null, receivedAt });
    act(() => fixture.measurement.send(0, 75));
    expect(result.current).toMatchObject({ status: "receiving", bpm: 75, receivedAt: Date.now() });
  });

  it("clears prior BPM for no-contact and malformed packets without refreshing freshness", async () => {
    const { result } = mount();
    await act(() => result.current.connect());
    act(() => fixture.measurement.send(0, 72));
    act(() => { vi.advanceTimersByTime(20_000); fixture.measurement.send(4, 99); });
    expect(result.current).toMatchObject({ status: "waiting", bpm: null, receivedAt: null });
    expect(result.current.message).toContain("no contact");
    act(() => { vi.advanceTimersByTime(10_000); fixture.measurement.send(1); });
    expect(result.current).toMatchObject({ status: "stale", bpm: null });
    expect(result.current.history).toHaveLength(1);
  });

  it.each(["manual", "unexpected"])("cleans up a %s disconnect without switching back to demo", async kind => {
    const { result } = mount();
    await act(() => result.current.connect());
    act(() => fixture.measurement.send(0, 72));
    act(() => {
      if (kind === "manual") result.current.disconnect();
      else fixture.device.dispatchEvent(new Event("gattserverdisconnected"));
    });
    expect(result.current).toMatchObject({ mode: "device", status: "disconnected", bpm: null, receivedAt: null });
    expect(fixture.measurement.stopNotifications).toHaveBeenCalledTimes(1);
    act(() => fixture.measurement.send(0, 99));
    expect(result.current.bpm).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["NotFoundError", "NotAllowedError", "NetworkError"])("handles %s and allows retry with freshly fetched GATT objects", async name => {
    requestDevice.mockRejectedValueOnce(Object.assign(new Error("failure"), { name }));
    const { result } = mount();
    await act(() => result.current.connect());
    expect(result.current.status).toBe(name === "NotFoundError" ? "disconnected" : "error");
    expect(result.current.bpm).toBeNull();
    await act(() => result.current.connect());
    expect(result.current.status).toBe("waiting");
    act(() => result.current.disconnect());
    await act(() => result.current.connect());
    expect(fixture.server.getPrimaryService).toHaveBeenCalledTimes(2);
    expect(fixture.characteristic).toHaveBeenCalledTimes(2);
  });

  it("handles failed notifications and releases the connection", async () => {
    fixture.measurement.startNotifications.mockRejectedValueOnce(new Error("no notifications"));
    const { result } = mount();
    await act(() => result.current.connect());
    expect(result.current).toMatchObject({ status: "error", bpm: null });
    expect(fixture.server.disconnect).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("distinguishes a missing GATT service from picker cancellation", async () => {
    vi.mocked(fixture.server.getPrimaryService).mockRejectedValueOnce(Object.assign(new Error("missing service"), { name: "NotFoundError" }));
    const { result } = mount();
    await act(() => result.current.connect());
    expect(result.current).toMatchObject({ status: "error", bpm: null });
    expect(result.current.message).toContain("Could not connect to the heart rate service");
  });

  it("marks a connected device stale even if it never sends a reading", async () => {
    const { result } = mount();
    await act(() => result.current.connect());
    act(() => vi.advanceTimersByTime(30_000));
    expect(result.current).toMatchObject({ status: "stale", bpm: null, history: [] });
  });

  it("guards concurrent clicks and ignores a cancelled pending picker", async () => {
    const pending = deferred<HeartRateDevice>();
    requestDevice.mockReturnValueOnce(pending.promise);
    const { result } = mount();
    let connection!: Promise<void>;
    act(() => { connection = result.current.connect(); void result.current.connect(); });
    expect(requestDevice).toHaveBeenCalledTimes(1);
    act(() => result.current.disconnect());
    await act(async () => { pending.resolve(fixture.device); await connection; });
    expect(fixture.server.connect).not.toHaveBeenCalled();
    expect(result.current.status).toBe("disconnected");
  });

  it.each(["person", "reset"])("clears data and disconnects immediately on %s change", async change => {
    const { result, rerender } = mount();
    await act(() => result.current.connect());
    act(() => fixture.measurement.send(0, 72));
    rerender({ personId: change === "person" ? "P-02" : "P-01", resetKey: change === "reset" ? 1 : 0 });
    expect(result.current).toMatchObject({ mode: "demo", bpm: null, receivedAt: null, history: [], deviceName: null });
    expect(fixture.server.disconnect).toHaveBeenCalled();
    act(() => fixture.measurement.send(0, 99));
    expect(result.current.bpm).toBeNull();
  });

  it.each(["person", "unmount", "disconnect", "demo"])("closes a late GATT connection after %s", async action => {
    const pending = deferred<HeartRateGattServer>();
    vi.mocked(fixture.server.connect).mockReturnValueOnce(pending.promise);
    const { result, rerender, unmount } = mount();
    let connection!: Promise<void>;
    await act(async () => { connection = result.current.connect(); await Promise.resolve(); });
    act(() => {
      if (action === "person") rerender({ personId: "P-02", resetKey: 0 });
      else if (action === "unmount") unmount();
      else if (action === "disconnect") result.current.disconnect();
      else result.current.useDemo();
    });
    await act(async () => {
      Object.assign(fixture.server, { connected: true });
      pending.resolve(fixture.server);
      await connection;
    });
    expect(fixture.server.connected).toBe(false);
    expect(fixture.server.getPrimaryService).not.toHaveBeenCalled();
    if (action !== "unmount") expect(result.current.mode).toBe(action === "disconnect" ? "device" : "demo");
  });

  it("does not let an old pending connection disconnect a newer owner of the same device", async () => {
    const pending = deferred<HeartRateGattServer>();
    vi.mocked(fixture.server.connect).mockReturnValueOnce(pending.promise);
    const { result, rerender } = mount();
    let oldConnection!: Promise<void>;
    await act(async () => { oldConnection = result.current.connect(); await Promise.resolve(); });
    rerender({ personId: "P-02", resetKey: 0 });
    await act(() => result.current.connect());
    expect(fixture.server.connected).toBe(true);
    const disconnectCalls = vi.mocked(fixture.server.disconnect).mock.calls.length;
    await act(async () => { pending.resolve(fixture.server); await oldConnection; });
    expect(fixture.server.disconnect).toHaveBeenCalledTimes(disconnectCalls);
    expect(result.current).toMatchObject({ status: "waiting", mode: "device" });
  });

  it("cleans up listeners, notifications and timer on unmount", async () => {
    const remove = vi.spyOn(fixture.measurement, "removeEventListener");
    const { result, unmount } = mount();
    await act(() => result.current.connect());
    unmount();
    expect(remove).toHaveBeenCalledWith("characteristicvaluechanged", expect.any(Function));
    expect(fixture.measurement.stopNotifications).toHaveBeenCalledTimes(1);
    expect(fixture.server.disconnect).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("can explicitly return to demo and works through Strict Mode effect remounts", async () => {
    const wrapper = ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>;
    const { result } = renderHook(() => useHeartRate("P-01"), { wrapper });
    await act(() => result.current.connect());
    act(() => fixture.measurement.send(0, 72));
    act(() => result.current.useDemo());
    expect(result.current).toMatchObject({ mode: "demo", status: "idle", bpm: null, history: [] });
    await act(() => result.current.connect());
    expect(result.current.status).toBe("waiting");
  });
});
