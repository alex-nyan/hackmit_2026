"use client";

import { useState, useSyncExternalStore } from "react";

import { getDiagnostics, getServerDiagnostics, subscribeDiagnostics } from "./diagnostics";
import styles from "./LiveDiagnostics.module.css";

const metric = (value: number | undefined, unit: string) =>
  value === undefined ? "Unavailable" : `${value.toFixed(value < 10 ? 1 : 0)} ${unit}`;

/** Collapsed by default; normal viewing does not need transport internals. */
export function LiveDiagnostics({ sourceId }: { sourceId?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <details className={styles.details} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>Stream diagnostics</summary>
      {open && <Readings sourceId={sourceId} />}
    </details>
  );
}

function Readings({ sourceId }: { sourceId?: string }) {
  const data = useSyncExternalStore(subscribeDiagnostics, getDiagnostics, getServerDiagnostics);
  const [copied, setCopied] = useState<string | null>(null);
  const peers = data.peers.filter((peer) => !sourceId || peer.sourceId === sourceId);
  const active = peers.filter((peer) => peer.active);
  const lastFailure = peers.filter((peer) => !peer.active && peer.issue).at(-1)?.issue;

  async function copy() {
    try {
      await navigator.clipboard.writeText(
        JSON.stringify(
          {
            capturedAt: new Date().toISOString(),
            peers,
            playback: data.playback.filter((item) => !sourceId || item.sourceId === sourceId),
          },
          null,
          2,
        ),
      );
      setCopied("Copied");
    } catch {
      setCopied("Copy unavailable in this browser");
    }
  }

  return (
    <div className={styles.readings}>
      <p>
        Readings stay in this browser. Network round trip and buffering are separate parts of video
        delay.
      </p>
      {active.length === 0 && (
        <p>No active video connection. A displayed snapshot is not live video.</p>
      )}
      {lastFailure && <p>Last connection: {lastFailure}</p>}
      {active.map((peer) => {
        const sample = peer.sample;
        const rendered = data.playback.find((item) => item.sourceId === peer.sourceId);
        const rendering = rendered && sample && sample.timestamp - rendered.lastFrameAt < 3_000;
        return (
          <div key={`${peer.role}/${peer.sourceId}/${peer.peerId}`} className={styles.peer}>
            <strong>
              {peer.sourceId} · {peer.role === "publisher" ? "Sending" : "Receiving"} ·{" "}
              {peer.connectionState}
            </strong>
            <dl>
              <dt>Route</dt>
              <dd>{sample?.route ?? "Finding route"}</dd>
              <dt>Video</dt>
              <dd>
                {metric(sample?.videoKbps, "kbps")} · {metric(sample?.fps, "fps")}
              </dd>
              <dt>Audio</dt>
              <dd>{metric(sample?.audioKbps, "kbps")}</dd>
              <dt>Network round trip</dt>
              <dd>{metric(sample?.rttMs, "ms")}</dd>
              {peer.role === "publisher" ? (
                <>
                  <dt>Encode / send queue</dt>
                  <dd>
                    {metric(sample?.encodeMs, "ms")} / {metric(sample?.sendQueueMs, "ms")}
                  </dd>
                  <dt>Video limit</dt>
                  <dd>
                    {metric(
                      sample?.maxBitrate === undefined ? undefined : sample.maxBitrate / 1_000,
                      "kbps",
                    )}
                  </dd>
                  <dt>Quality limited by</dt>
                  <dd>{sample?.qualityLimitationReason ?? "Unavailable"}</dd>
                </>
              ) : (
                <>
                  <dt>Buffer / decode</dt>
                  <dd>
                    {metric(sample?.jitterBufferMs, "ms")} / {metric(sample?.decodeMs, "ms")}
                  </dd>
                  <dt>Packet loss</dt>
                  <dd>{metric(sample?.lossPercent, "%")}</dd>
                  <dt>Estimated frame age</dt>
                  <dd>
                    {rendering ? metric(rendered.frameAgeMs, "ms") : "No recent rendered frame"}
                  </dd>
                  <dt>First frame after attach</dt>
                  <dd>{metric(rendered?.firstFrameMs, "ms")}</dd>
                </>
              )}
              <dt>Codec</dt>
              <dd>{sample?.codec ?? "Negotiating"}</dd>
            </dl>
            {peer.issue && <p>{peer.issue}</p>}
          </div>
        );
      })}
      <p>
        Frame age is available only when the browser exposes capture timing. It excludes unmeasured
        iPhone-to-Mac delay.
      </p>
      <button type="button" onClick={() => void copy()}>
        Copy diagnostic report
      </button>
      {copied && <span role="status">{copied}</span>}
    </div>
  );
}
