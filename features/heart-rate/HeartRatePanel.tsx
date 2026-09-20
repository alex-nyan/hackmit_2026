"use client";

import { useId, useSyncExternalStore } from "react";
import { Bluetooth, HeartPulse } from "lucide-react";
import type { HeartRateConnection } from "./useHeartRate";
import styles from "./HeartRatePanel.module.css";

const subscribe = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

const statusLabels: Record<HeartRateConnection["status"], string> = {
  idle: "Not connected",
  unsupported: "Browser unavailable",
  requesting: "Choose a device",
  connecting: "Connecting",
  waiting: "Waiting for a reading",
  receiving: "Live device",
  stale: "Reading stale",
  disconnected: "Disconnected",
  error: "Connection issue",
};

export function HeartRatePanel({
  connection,
  personId,
  personName,
  compact = false,
}: {
  connection: HeartRateConnection;
  personId: string;
  personName: string;
  compact?: boolean;
}) {
  const descriptionId = useId();
  const hydrated = useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
  const busy = connection.status === "requesting" || connection.status === "connecting";
  const connected = ["waiting", "receiving", "stale"].includes(connection.status);
  const reconnect = connection.status === "disconnected" || connection.status === "error";
  const received = connection.receivedAt === null ? null : new Date(connection.receivedAt);
  const validReceived = received !== null && Number.isFinite(received.getTime());
  const isLive = connection.mode === "device" && connection.status === "receiving";

  return (
    <section
      className={`${styles.panel} ${compact ? styles.compact : ""}`}
      aria-label="Heart rate connection"
      aria-describedby={descriptionId}
    >
      <div className={styles.heading}>
        <span className={styles.title}>
          <HeartPulse size={17} aria-hidden="true" /> Heart rate source
        </span>
        <span className={`${styles.badge} ${isLive ? styles.live : ""}`}>
          {connection.mode === "demo" ? "Demo" : statusLabels[connection.status]}
        </span>
      </div>
      <p className={styles.person}>
        Test profile ·{" "}
        <strong>
          {personId} · {personName}
        </strong>
      </p>
      <div className={styles.actions}>
        {connected ? (
          <button type="button" className={styles.connect} onClick={connection.disconnect}>
            <Bluetooth size={15} aria-hidden="true" /> Disconnect
          </button>
        ) : (
          <button
            type="button"
            className={styles.connect}
            disabled={busy}
            onClick={() => void connection.connect()}
          >
            <Bluetooth size={15} aria-hidden="true" />
            {busy
              ? connection.status === "requesting"
                ? "Choose a device…"
                : "Connecting…"
              : reconnect
                ? "Reconnect Heart Rate"
                : "Connect Heart Rate"}
          </button>
        )}
        {connection.mode === "device" && (
          <button type="button" className={styles.demo} onClick={connection.useDemo}>
            Use demo heart rate
          </button>
        )}
      </div>
      <p className={styles.status} role="status" aria-live="polite" aria-atomic="true">
        {connection.message}
      </p>
      {connection.supported === false && (
        <p className={styles.support}>
          Web Bluetooth is unavailable here. Use Chrome on a Mac or Windows laptop, on localhost or
          HTTPS.
        </p>
      )}
      {connection.mode === "device" && connection.deviceName && (
        <p className={styles.metadata}>Device · {connection.deviceName}</p>
      )}
      {connection.mode === "device" && hydrated && validReceived && (
        <p className={styles.metadata}>
          Received ·{" "}
          <time dateTime={received.toISOString()}>
            {received.toLocaleTimeString(undefined, {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            })}
          </time>{" "}
          <span>(this browser)</span>
        </p>
      )}
      <p id={descriptionId} className={styles.disclosure}>
        Connect your own device for testing a fictional profile. Readings stay in this tab unless
        you choose “Share current heart rate” in Situation &amp; medic report. Shared snapshots are
        saved to the workspace log. No automatic alerts.
      </p>
      <details className={styles.setup}>
        <summary>HeartCast setup &amp; privacy</summary>
        <p className={styles.path}>Apple Watch → iPhone HeartCast → laptop Chrome</p>
        <ol>
          <li>
            Open HeartCast on your iPhone and Apple Watch. Start the Watch session and keep the
            iPhone app visible.
          </li>
          <li>
            Turn Bluetooth on for your phone and laptop. Use Chrome on the laptop with localhost or
            HTTPS.
          </li>
          <li>
            Choose Connect Heart Rate, then select your HeartCast device in the browser picker.
          </li>
        </ol>
        <p>
          No reading yet? Check the Watch session and HeartCast broadcast, then reconnect. This
          panel cannot confirm who is wearing the device.
        </p>
        <p>
          “Received” is when this browser received a reading, not the sensor measurement time.
          Disconnecting or switching profiles clears the device reading. Demo playback and emergency
          decisions remain separate.
        </p>
        <p>
          Only this tab receives the continuous readings; explicitly shared snapshots appear in
          other workspaces. Close this tab to end its local session. HeartCast is a separate app
          with its own data handling.
        </p>
      </details>
    </section>
  );
}
