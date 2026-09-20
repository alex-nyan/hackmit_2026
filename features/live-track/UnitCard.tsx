"use client";

import { HeartPulse, X } from "lucide-react";
import { useEffect, useState } from "react";

import { useBodyCamWall } from "@/features/body-cam";
import { LiveTile } from "@/features/live-video";
import { LiveDiagnostics } from "@/features/live-video/LiveDiagnostics";
import type { WatchState } from "@/features/live-video/useLiveWatcher";
import { describeAge } from "@/features/body-cam/BodyCamWall";
import { ageMs } from "@/features/body-cam/frames";
import type { HeartRateConnection } from "@/features/heart-rate/useHeartRate";

import {
  formatAccuracy,
  formatAge,
  formatCoordinates,
  formatSpeed,
  freshnessLabel,
} from "./format";
import { FRESHNESS_COLOR } from "./liveLayer";
import type { LiveDevice } from "./types";
import styles from "./UnitCard.module.css";

/**
 * One unit, opened from the map.
 *
 * The roster answers "who is out there"; this answers "who is that". It is the
 * screen somebody reaches for after a dot moves somewhere it should not be, so
 * it carries the three things that decide what to do about it: what the unit
 * can see, how the person holding it is doing, and how much the position on
 * screen can still be trusted.
 *
 * Every one of those can be absent, and each says so in its own words. A unit
 * publishing a position with the camera off is not a broken feed, and a
 * dashboard with no heart rate device paired is not a flat line.
 */

interface UnitCardProps {
  device: LiveDevice;
  /**
   * The Bluetooth reading this dashboard is receiving, if any.
   *
   * It belongs to the dashboard rather than to the unit — the strap is paired
   * to this browser, not carried by whoever scanned the code — so the card
   * names the device it came from instead of implying the dot on the map
   * measured it.
   */
  heartRate?: HeartRateConnection | null;
  onDismiss: () => void;
}

export function UnitCard({ device, heartRate, onDismiss }: UnitCardProps) {
  const { frames, status } = useBodyCamWall();
  const [live, setLive] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [streamState, setStreamState] = useState<WatchState>("idle");
  const [now, setNow] = useState(() => Date.now());
  const frame = frames.find((published) => published.sourceId === device.id) ?? null;
  const { fix } = device;

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);

  return (
    <aside className="live-card" role="status" aria-label={`Unit ${device.name}`}>
      <div className="panel-head">
        <span className="panel-label">
          <span
            className={styles.dot}
            style={{ background: fix ? FRESHNESS_COLOR[fix.freshness] : FRESHNESS_COLOR.lost }}
            aria-hidden="true"
          />
          {fix ? freshnessLabel(fix.freshness) : "No fix"}
        </span>
        <button
          type="button"
          className="building-card__close"
          onClick={onDismiss}
          aria-label={`Close ${device.name}`}
        >
          <X size={14} />
        </button>
      </div>

      <h3 className={styles.name}>{device.name}</h3>

      <div className={styles.stage}>
        {/* A selected unit always gets a live attempt, even before its first
            AI snapshot or when discovery is temporarily unavailable. */}
        <LiveTile
          key={device.id}
          sourceId={device.id}
          className={styles.frame}
          onLiveChange={setLive}
          onStateChange={setStreamState}
          audioEnabled={audioEnabled}
          alt={
            live ? `Live camera from ${device.name}` : `Latest frame published by ${device.name}`
          }
          fallbackSrc={
            frame
              ? `/api/streams/${encodeURIComponent(device.id)}/frame?live=${Date.parse(frame.at)}`
              : undefined
          }
        />
      </div>

      {/* Snapshot age remains visible independently from live-media health. */}
      <p className={styles.frameNote}>
        {live
          ? "Live · direct from this unit's camera"
          : frame
            ? `Latest still · ${describeAge(ageMs(frame, now))}`
            : streamState === "connecting"
              ? "Connecting to this unit's camera…"
              : status === "offline"
                ? "Camera discovery is unavailable. The live connection will retry."
                : "No live video or recent still is available."}
      </p>
      {live && (
        <label className={styles.frameNote}>
          <input
            type="checkbox"
            checked={audioEnabled}
            onChange={(event) => setAudioEnabled(event.target.checked)}
          />{" "}
          Listen to shared audio
        </label>
      )}

      <LiveDiagnostics sourceId={device.id} />

      <HeartRate connection={heartRate ?? null} />

      {fix && (
        <dl className="panel-facts">
          <div>
            <dt>Last fix</dt>
            <dd>{formatAge(fix.ageSeconds)}</dd>
          </div>
          <div>
            <dt>Accuracy</dt>
            <dd>{formatAccuracy(fix)}</dd>
          </div>
          <div>
            <dt>Position</dt>
            <dd>{formatCoordinates(fix)}</dd>
          </div>
          <div>
            <dt>Speed</dt>
            <dd>{formatSpeed(fix) ?? "not reported"}</dd>
          </div>
        </dl>
      )}
    </aside>
  );
}

/**
 * What this dashboard is hearing from a heart rate strap.
 *
 * Reported as the dashboard's reading rather than the unit's, because that is
 * what it is: the device is paired to this browser over Bluetooth. Saying
 * otherwise would put a number under somebody's name that nothing on their
 * phone ever measured.
 */
function HeartRate({ connection }: { connection: HeartRateConnection | null }) {
  const live =
    connection?.mode === "device" && connection.status === "receiving" && connection.bpm !== null;

  if (live && connection) {
    return (
      <div className={styles.vital}>
        <span className={styles.vitalLabel}>
          <HeartPulse size={15} aria-hidden="true" /> Heart rate
        </span>
        <span className={styles.bpm}>
          {connection.bpm}
          <small>bpm</small>
        </span>
        <span className={styles.vitalSource}>
          {connection.deviceName ?? "Paired device"} · paired to this dashboard
        </span>
      </div>
    );
  }

  return (
    <div className={styles.vital}>
      <span className={styles.vitalLabel}>
        <HeartPulse size={15} aria-hidden="true" /> Heart rate
      </span>
      <span className={styles.vitalMissing}>Not reporting</span>
      <span className={styles.vitalSource}>
        {connection?.supported === false
          ? "This browser cannot reach a Bluetooth heart rate device."
          : "No heart rate device is paired to this dashboard."}
      </span>
      {connection && connection.supported !== false && (
        <button type="button" className={styles.connect} onClick={() => void connection.connect()}>
          Connect a device
        </button>
      )}
    </div>
  );
}
