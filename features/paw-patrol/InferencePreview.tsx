"use client";

import { useEffect, useState } from "react";
import { Eye, TriangleAlert } from "lucide-react";
import { BentoLabel } from "@/components/ui/builder-os-bento";
import { isAudioConcern } from "./AudioAlerts";
import type { IncidentEvent } from "./incidents";
import type { BusStatus } from "./useIncidentBus";
import styles from "./InferencePreview.module.css";

export function InferencePreview({
  titleId = "dispatch-inference-title",
  events = [],
  status = "connecting",
  selectedSource,
}: {
  titleId?: string;
  events?: IncidentEvent[];
  status?: BusStatus;
  selectedSource?: string | null;
}) {
  const [now, setNow] = useState(0);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const timer = setInterval(tick, 5000);
    return () => clearInterval(timer);
  }, []);
  const recent = [...events].sort((a, b) => b.seq - a.seq);
  const alert = recent.find(
    (event) => isAudioConcern(event) && (!selectedSource || event.source === selectedSource),
  );
  const source = selectedSource ?? alert?.source;
  const camera = source
    ? recent.find(
        (event) =>
          event.source === source &&
          event.origin === "model" &&
          (event.kind === "observation" || event.kind === "hazard") &&
          event.provenance?.provider !== "browser",
      )
    : undefined;
  const age = camera ? now - Date.parse(camera.observedAt ?? camera.at) : Infinity;
  const matched = Boolean(
    camera &&
    alert &&
    Math.abs(
      Date.parse(camera.observedAt ?? camera.at) - Date.parse(alert.observedAt ?? alert.at),
    ) <= 60_000,
  );
  const fresh = status === "live" && age >= 0 && age <= 60_000;
  return (
    <div className={styles.preview}>
      <BentoLabel icon={Eye}>Incident visual context</BentoLabel>
      <h2 id={titleId}>Scene observations</h2>
      <p className={styles.sampleNotice}>
        {source ? `Reporting camera: ${source}` : "Waiting for an audio concern"} · unverified
      </p>
      {alert && <p className={styles.reviewNote}>{alert.detail}</p>}
      {camera ? (
        <article className={styles.observation} data-review="true">
          <strong>
            {fresh && matched
              ? "Recent camera observation"
              : "Historical / unmatched camera observation"}
          </strong>
          <p>{camera.detail}</p>
          <small>
            {camera.observedAt ?? camera.at} · {camera.provenance?.model ?? "Unknown model"}
          </small>
          {!matched && <small>This frame is not within one minute of the audio report.</small>}
        </article>
      ) : (
        <p>
          No camera description for this source yet. Start its camera to populate visual context.
        </p>
      )}
      <p className={styles.reviewNote}>
        <TriangleAlert size={13} aria-hidden="true" />
        <span>
          Visible appearance and objects only. A frame does not identify the speaker or establish
          who is a suspect. Confirm against footage.
        </span>
      </p>
      {status !== "live" && <p>Updates disconnected; descriptions may be out of date.</p>}
    </div>
  );
}
