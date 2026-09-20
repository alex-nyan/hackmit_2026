"use client";

import { useEffect, useState } from "react";
import type { Detection, IncidentSnapshot } from "../../../../shared/contracts";
import styles from "./LiveWorkspace.module.css";
import { effectiveFreshness, sourceAvailability } from "./freshness";

/** Each URL names one immutable capture. A missing item must never select a newer frame. */
export function EvidencePreview({
  evidenceId,
  detections = [],
}: {
  evidenceId: string;
  detections?: Detection[];
}) {
  const [open, setOpen] = useState(false);
  const [media, setMedia] = useState<{ url: string; type: string } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!open) return;
    const abort = new AbortController();
    let objectUrl: string | undefined;
    void (async () => {
      try {
        const response = await fetch(`/api/live/evidence/${encodeURIComponent(evidenceId)}`, {
          cache: "no-store",
          signal: AbortSignal.any([abort.signal, AbortSignal.timeout(10_000)]),
        });
        if (!response.ok) {
          throw new Error(
            response.status === 404
              ? "Evidence expired or unavailable. This capture cannot be reviewed."
              : "Evidence unavailable or access was denied.",
          );
        }
        const type = response.headers.get("content-type")?.split(";", 1)[0] ?? "";
        if (
          type !== "image/jpeg" &&
          ![
            "audio/wav",
            "audio/mp4",
            "audio/aac",
            "audio/mpeg",
            "audio/webm",
            "audio/ogg",
          ].includes(type)
        ) {
          throw new Error("Unsupported evidence format.");
        }
        const blob = await response.blob();
        if (abort.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setMedia({ url: objectUrl, type });
      } catch (issue) {
        if (!abort.signal.aborted)
          setError(issue instanceof Error ? issue.message : "Evidence unavailable.");
      }
    })();
    return () => {
      abort.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [open, evidenceId]);
  return (
    <div>
      <button
        className={`${styles.button} ${styles.secondary}`}
        onClick={() => {
          setMedia(null);
          setError("");
          setOpen(!open);
        }}
      >
        {open ? "Close evidence" : "Review capture"}
      </button>
      {open && !media && !error && <p role="status">Loading this capture…</p>}
      {open && error && (
        <p role="status" className={styles.warning}>
          {error}
        </p>
      )}
      {open &&
        media &&
        (media.type === "image/jpeg" ? (
          <div className={styles.evidence}>
            {/* The exact local evidence URL is required; Next image optimization would cache sensitive frames. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={media.url} alt="Recorded camera evidence; model boxes are unverified" />
            <svg viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true">
              {detections.map((detection, index) => (
                <rect
                  key={index}
                  x={detection.bbox.x1}
                  y={detection.bbox.y1}
                  width={detection.bbox.x2 - detection.bbox.x1}
                  height={detection.bbox.y2 - detection.bbox.y1}
                  fill="none"
                  stroke="#ffd166"
                  strokeWidth="0.004"
                />
              ))}
            </svg>
          </div>
        ) : (
          <audio controls preload="none" src={media.url}>
            Audio playback unavailable.
          </audio>
        ))}
    </div>
  );
}

export function MediaObservations({
  snapshot,
  connected,
  serverNow,
}: {
  snapshot: IncidentSnapshot;
  connected: boolean;
  serverNow: number;
}) {
  // Show the latest observation per source/channel. Old evidence remains attached to its alert.
  const latest = new Map<string, IncidentSnapshot["observations"][number]>();
  for (const observation of snapshot.observations) {
    if (!["visual", "transcript", "context"].includes(observation.kind)) continue;
    const key = `${observation.source_id}:${observation.kind}`;
    const previous = latest.get(key);
    if (!previous || Date.parse(observation.measured_at) > Date.parse(previous.measured_at))
      latest.set(key, observation);
  }
  return (
    <section className={styles.panel}>
      <h2>Camera and audio observations</h2>
      <p>Model output requires human review. Missing detections do not establish scene safety.</p>
      {!latest.size && <p>No accessible camera or audio result received.</p>}
      <div className={styles.grid}>
        {[...latest.values()].map((observation) => {
          const value = observation.value;
          const source = snapshot.sources.find((item) => item.source_id === observation.source_id);
          const current =
            effectiveFreshness(observation, connected, serverNow) === "fresh" &&
            source !== undefined &&
            sourceAvailability(source, connected, serverNow) === "available";
          return (
            <article className={styles.card} key={observation.observation_id}>
              <h3>
                {source?.display_name ?? observation.source_id} · {observation.kind}
              </h3>
              <span className={`${styles.status} ${!current ? styles.stale : ""}`}>
                {current ? "Recent observation" : "Retained / not current"}
              </span>
              <p className={styles.meta}>
                Captured {new Date(observation.measured_at).toLocaleTimeString()} ·{" "}
                {observation.source_id}
              </p>
              {"media_id" in value && (
                <>
                  {value.status === "unavailable" ? (
                    <p className={styles.warning}>Inference unavailable for this capture.</p>
                  ) : (
                    <>
                      {value.kind === "frame" && (
                        <p>
                          {value.detections.length
                            ? value.detections.map((item) => item.label).join(" · ")
                            : "No supported object detected in this frame."}
                        </p>
                      )}
                      {value.transcript && (
                        <>
                          <p>
                            <strong>Machine transcript · unverified</strong>
                          </p>
                          <p>{value.transcript.text || "No speech transcribed."}</p>
                          <p className={styles.meta}>
                            No speaker identity or attribution is established.
                          </p>
                        </>
                      )}
                    </>
                  )}
                  {value.evidence_refs.map((id) => (
                    <EvidencePreview key={id} evidenceId={id} detections={value.detections} />
                  ))}
                  {!!value.models.length && (
                    <p className={styles.meta}>
                      {value.models
                        .map(
                          (model) =>
                            `${model.provider}: ${model.model}${model.revision ? ` (${model.revision})` : ""}`,
                        )
                        .join(" · ")}
                    </p>
                  )}
                  {!!value.warnings.length && (
                    <p className={styles.meta}>{value.warnings.join(" · ")}</p>
                  )}
                </>
              )}
              {"context_id" in value && (
                <>
                  <p>
                    <strong>Unverified visual description</strong>
                  </p>
                  <p>{value.summary}</p>
                  <p className={styles.warning}>{value.limitations.join(" · ")}</p>
                  <p className={styles.meta}>
                    {value.model.model} · based on revision {value.snapshot_revision}. Cannot
                    authorize scene access or actions.
                  </p>
                  {value.evidence_refs.map((id) => (
                    <EvidencePreview key={id} evidenceId={id} />
                  ))}
                </>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
