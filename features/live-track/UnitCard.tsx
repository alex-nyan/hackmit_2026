"use client";

import { HeartPulse, VideoOff, X } from "lucide-react";

import { useBodyCamWall } from "@/features/body-cam";
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
  const frame = frames.find((published) => published.sourceId === device.id) ?? null;
  const { fix } = device;

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
        {frame ? (
          // `live` rather than `at`: `at` names a moment in the archive and
          // would send this looking for a frame nobody kept. This one is only
          // a cache key — a new publish is a new URL, so the browser refetches
          // exactly when there is something new and never twice for the same
          // still. The route always answers with the latest.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            className={styles.frame}
            src={`/api/streams/${encodeURIComponent(device.id)}/frame?live=${Date.parse(frame.at)}`}
            alt={`Latest frame published by ${device.name}`}
          />
        ) : (
          <p className={styles.stageHint}>
            <VideoOff size={15} aria-hidden="true" />
            {status === "offline"
              ? "This dashboard has stopped seeing the camera wall."
              : "Camera off. This unit is publishing a position but no video."}
          </p>
        )}
      </div>

      {/* Stills at roughly one every two seconds, which is not video and is
          never presented as though it were. */}
      {frame && <p className={styles.frameNote}>Latest frame · about one every two seconds</p>}

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
