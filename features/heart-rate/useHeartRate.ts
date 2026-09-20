"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import {
  getHeartRateBluetooth,
  type HeartRateCharacteristic,
  type HeartRateDevice,
} from "./bluetooth";
import { parseHeartRateMeasurement } from "./measurement";

export type HeartRateStatus =
  | "idle"
  | "unsupported"
  | "requesting"
  | "connecting"
  | "waiting"
  | "receiving"
  | "stale"
  | "disconnected"
  | "error";
export interface HeartRateSample {
  bpm: number;
  receivedAt: number;
}

interface Snapshot {
  mode: "demo" | "device";
  status: HeartRateStatus;
  bpm: number | null;
  receivedAt: number | null;
  deviceName: string | null;
  message: string;
  history: HeartRateSample[];
  supported: boolean | null;
}

const STALE_AFTER_MS = 30_000;
const INITIAL: Snapshot = {
  mode: "demo",
  status: "idle",
  bpm: null,
  receivedAt: null,
  deviceName: null,
  message: "Demo heart rate. Connect a Bluetooth device to use its readings in this tab.",
  history: [],
  supported: null,
};
const owners = new WeakMap<HeartRateDevice, symbol>();

interface Attempt {
  token: symbol;
  device?: HeartRateDevice;
  measurement?: HeartRateCharacteristic;
  onMeasurement?: EventListener;
  onDisconnect?: EventListener;
  lastUsableAt?: number;
}

/** The store owns browser resources; it never persists or transmits measurements. */
class HeartRateStore {
  constructor(readonly owner: { personId: string; resetKey: number }) {}

  private snapshot: Snapshot = INITIAL;
  private listeners = new Set<() => void>();
  private active: Attempt | null = null;
  private mounted = false;
  private staleTimer: ReturnType<typeof setTimeout> | undefined;

  getSnapshot = () => this.snapshot;
  getServerSnapshot = () => INITIAL;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private update(patch: Partial<Snapshot>) {
    if (!this.mounted) return;
    this.snapshot = { ...this.snapshot, ...patch };
    this.listeners.forEach((listener) => listener());
  }

  mount = () => {
    this.mounted = true;
    const supported = Boolean(getHeartRateBluetooth());
    this.update({ ...INITIAL, supported, status: supported ? "idle" : "unsupported" });
    return () => {
      this.mounted = false;
      this.release();
    };
  };

  private isCurrent(attempt: Attempt) {
    return this.mounted && this.active === attempt;
  }

  private clearTimer() {
    if (this.staleTimer !== undefined) clearTimeout(this.staleTimer);
    this.staleTimer = undefined;
  }

  private armStaleTimer(attempt: Attempt) {
    this.clearTimer();
    const remaining = Math.max(
      0,
      STALE_AFTER_MS - (Date.now() - (attempt.lastUsableAt ?? Date.now())),
    );
    const markStale = () => {
      if (this.isCurrent(attempt))
        this.update({
          status: "stale",
          bpm: null,
          message: "No usable reading for 30 seconds. Check HeartCast and sensor contact.",
        });
    };
    if (remaining === 0) markStale();
    else this.staleTimer = setTimeout(markStale, remaining);
  }

  private release() {
    this.clearTimer();
    const attempt = this.active;
    this.active = null; // Invalidate callbacks before touching browser resources.
    if (!attempt) return;
    if (attempt.measurement && attempt.onMeasurement) {
      attempt.measurement.removeEventListener("characteristicvaluechanged", attempt.onMeasurement);
    }
    if (attempt.device && attempt.onDisconnect) {
      attempt.device.removeEventListener("gattserverdisconnected", attempt.onDisconnect);
    }
    if (attempt.device && owners.get(attempt.device) === attempt.token) {
      if (attempt.measurement) {
        try {
          void attempt.measurement.stopNotifications().catch(() => {});
        } catch {
          /* Already gone. */
        }
      }
      try {
        attempt.device.gatt?.disconnect();
      } catch {
        /* Already gone. */
      }
      // Retain ownership until any in-flight connect resolves, so it can be closed.
      // WeakMap entries do not retain device objects; a newer attempt replaces this.
    }
  }

  private discardLateConnection(attempt: Attempt) {
    // A later attempt may already own the same browser device object.
    if (attempt.device && owners.get(attempt.device) === attempt.token) {
      try {
        attempt.device.gatt?.disconnect();
      } catch {
        /* Already gone. */
      }
      owners.delete(attempt.device);
    }
  }

  disconnect = () => {
    this.release();
    this.update({
      mode: "device",
      status: "disconnected",
      bpm: null,
      receivedAt: null,
      message: "Disconnected. Connect again to resume device readings.",
    });
  };

  useDemo = () => {
    this.release();
    this.update({
      ...INITIAL,
      supported: this.snapshot.supported,
      status: this.snapshot.supported ? "idle" : "unsupported",
    });
  };

  connect = async () => {
    if (!this.mounted || this.active) return;
    const bluetooth = getHeartRateBluetooth();
    this.update({ mode: "device", bpm: null, receivedAt: null, history: [], deviceName: null });
    if (!bluetooth) {
      this.update({
        supported: false,
        status: "unsupported",
        message:
          "Bluetooth requires a supported desktop browser such as Chrome, on HTTPS or localhost.",
      });
      return;
    }
    const attempt: Attempt = { token: Symbol("heart-rate-connection") };
    this.active = attempt;
    this.update({
      supported: true,
      status: "requesting",
      message: "Choose HeartCast in the browser’s Bluetooth picker.",
    });
    try {
      // No await before this call: preserve the button's user activation.
      const device = await bluetooth.requestDevice({ filters: [{ services: ["heart_rate"] }] });
      if (!this.isCurrent(attempt)) return;
      attempt.device = device;
      owners.set(device, attempt.token);
      if (!device.gatt) throw new Error("gatt-unavailable");
      attempt.onDisconnect = () => {
        if (!this.isCurrent(attempt)) return;
        this.release();
        this.update({
          status: "disconnected",
          bpm: null,
          receivedAt: null,
          message: "Device disconnected. Connect again to resume readings.",
        });
      };
      device.addEventListener("gattserverdisconnected", attempt.onDisconnect);
      this.update({
        status: "connecting",
        deviceName: device.name || "Heart rate device",
        message: "Connecting to the heart rate service…",
      });
      const server = await device.gatt.connect();
      if (!this.isCurrent(attempt)) {
        this.discardLateConnection(attempt);
        return;
      }
      const service = await server.getPrimaryService("heart_rate");
      if (!this.isCurrent(attempt)) {
        this.discardLateConnection(attempt);
        return;
      }
      const measurement = await service.getCharacteristic("heart_rate_measurement");
      if (!this.isCurrent(attempt)) {
        this.discardLateConnection(attempt);
        return;
      }
      attempt.measurement = measurement;
      attempt.onMeasurement = () => {
        if (!this.isCurrent(attempt)) return;
        const parsed = parseHeartRateMeasurement(measurement.value);
        if (parsed.kind !== "reading") {
          this.update({
            status: "waiting",
            bpm: null,
            receivedAt: null,
            message:
              parsed.kind === "no-contact"
                ? "Sensor reports no contact. Check the watch fit and wait for a reading."
                : "The device sent an unusable reading. Waiting for a valid measurement.",
          });
          this.armStaleTimer(attempt);
          return;
        }
        const sample = { bpm: parsed.bpm, receivedAt: Date.now() };
        attempt.lastUsableAt = sample.receivedAt;
        this.update({
          status: "receiving",
          ...sample,
          history: [...this.snapshot.history, sample].slice(-60),
          message: "Receiving device heart rate in this browser tab.",
        });
        this.armStaleTimer(attempt);
      };
      measurement.addEventListener("characteristicvaluechanged", attempt.onMeasurement);
      this.update({ status: "waiting", message: "Connected. Waiting for a heart rate reading…" });
      attempt.lastUsableAt = Date.now();
      this.armStaleTimer(attempt);
      await measurement.startNotifications();
      if (!this.isCurrent(attempt)) this.discardLateConnection(attempt);
      // A notification can arrive before startNotifications resolves. Keep its state.
    } catch (error) {
      if (!this.isCurrent(attempt)) {
        this.discardLateConnection(attempt);
        return;
      }
      this.release();
      const name = error instanceof Error ? error.name : "";
      const pickerCancelled = name === "NotFoundError" && !attempt.device;
      this.update({
        bpm: null,
        receivedAt: null,
        status: pickerCancelled ? "disconnected" : "error",
        message: pickerCancelled
          ? "No device selected. Start HeartCast and try connecting again."
          : name === "NotAllowedError" || name === "SecurityError"
            ? "Bluetooth permission was denied. Check browser and system permissions, then retry."
            : "Could not connect to the heart rate service. Check HeartCast, Bluetooth and other device connections, then retry.",
      });
    }
  };
}

export function useHeartRate(personId: string, resetKey = 0) {
  // A new store yields an empty snapshot immediately when the assigned person changes.
  const store = useMemo(() => new HeartRateStore({ personId, resetKey }), [personId, resetKey]);
  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getServerSnapshot,
  );
  useEffect(() => store.mount(), [store]);
  return {
    ...snapshot,
    connect: store.connect,
    disconnect: store.disconnect,
    useDemo: store.useDemo,
  };
}

export type HeartRateConnection = ReturnType<typeof useHeartRate>;
