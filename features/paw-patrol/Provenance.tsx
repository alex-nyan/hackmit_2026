"use client";

import { Radio, ShieldQuestion, Sparkles, WifiOff, Zap } from "lucide-react";

import type { MistDraft } from "./draftMist";
import { describeOrigin, type IncidentEvent } from "./incidents";
import type { BusStatus } from "./useIncidentBus";
import styles from "./Provenance.module.css";

/**
 * Every fact on screen should say where it came from and when.
 *
 * The live-tracking panel already separates a fix's age from the moment the
 * server heard about it. These components extend that habit to the rest of the
 * workspace, because the failure that matters here is the same one: a claim
 * rendered as established when it is a model's guess, or an observation
 * rendered as current when it is minutes old.
 */

export function ProvenanceChip({ event }: { event: IncidentEvent }) {
  const score = event.provenance?.confidence;
  return (
    <span className={styles.chip} data-origin={event.origin}>
      <span className={styles.chipOrigin}>{describeOrigin(event)}</span>
      <span className={styles.chipDot} aria-hidden="true" />
      <span>{event.source}</span>
      {event.provenance && (
        <>
          <span className={styles.chipDot} aria-hidden="true" />
          <span>
            {event.provenance.provider}/{event.provenance.model}
          </span>
        </>
      )}
      {typeof score === "number" && (
        <>
          <span className={styles.chipDot} aria-hidden="true" />
          {/* Never rendered as a percentage: it is not a probability. */}
          <span title="Uncalibrated model score, not a probability">{score.toFixed(2)}</span>
        </>
      )}
    </span>
  );
}

const STATUS_COPY: Record<BusStatus, { label: string; detail: string }> = {
  live: {
    label: "Workspaces in sync",
    detail: "Dispatch, Officer and Hospital are reading one incident log.",
  },
  connecting: {
    label: "Reconnecting",
    detail: "This workspace may be behind. Events are replayed on reconnect.",
  },
  offline: {
    label: "Not in sync",
    detail: "This workspace is showing only its own events. Others will not see them.",
  },
};

export function BusIndicator({ status, count }: { status: BusStatus; count: number }) {
  const copy = STATUS_COPY[status];
  return (
    <div className={styles.bus} data-status={status} role="status">
      {status === "live" ? <Radio size={15} /> : <WifiOff size={15} />}
      <strong>{copy.label}</strong>
      <span>{copy.detail}</span>
      <span className={styles.busCount}>
        {count} shared {count === 1 ? "event" : "events"}
      </span>
    </div>
  );
}

/** The shared log, rendered identically in whichever workspace is looking. */
export function SharedTimeline({ events }: { events: IncidentEvent[] }) {
  if (events.length === 0) {
    return (
      <p className={styles.empty}>
        No shared events yet. A panic request, a scene report or a camera hazard published from any
        workspace appears here in all of them.
      </p>
    );
  }
  return (
    <div className={styles.shared}>
      {[...events].reverse().map((event) => (
        <article key={event.seq} className={styles.sharedItem} data-origin={event.origin}>
          <header>
            <strong>{event.title}</strong>
            <time dateTime={event.at}>{new Date(event.at).toLocaleTimeString()}</time>
          </header>
          <p>{event.detail}</p>
          <ProvenanceChip event={event} />
        </article>
      ))}
    </div>
  );
}

/**
 * States the negatives explicitly.
 *
 * A dashboard that shows only what it knows invites the reader to fill the
 * silence, and the gaps here are exactly the ones a tired person would fill
 * wrongly: a detection read as a confirmation, a raised heart rate read as an
 * injury, an empty transcript read as silence. Saying them out loud costs one
 * panel and removes the inference.
 */
export function NotConcluded({
  events,
  personId,
  hasSavedRecord,
}: {
  events: IncidentEvent[];
  personId: string;
  hasSavedRecord: boolean;
}) {
  const modelEvents = events.filter(
    (event) => event.origin === "model" && event.personId === personId,
  );
  const sawWeapon = modelEvents.some((event) => event.title.includes("weapon"));
  const heardAudio = modelEvents.some((event) => event.kind === "transcript");

  const statements: string[] = [
    sawWeapon
      ? "A possible weapon was reported by a vision model and has not been confirmed by any person."
      : "No weapon has been reported in this run.",
    "No injury has been inferred from heart rate. A rising pulse establishes nothing on its own.",
    "No wound site, severity or diagnosis is known. The body view is a generic model, not a scan.",
    heardAudio
      ? "Audio matched distress wording. An empty or matching transcript is a machine hypothesis, not evidence of what was said."
      : "No audio has been analysed in this run.",
    "No scene has been assessed as safe. The service has no safe outcome to return.",
    hasSavedRecord
      ? "The saved handoff contains only what a person entered. Model drafts were not saved on their own."
      : "No handoff has been recorded yet. Unrecorded treatments must not be read as none given.",
  ];

  return (
    <section className={`panel ${styles.negative}`} aria-label="What this system has not concluded">
      <div className={styles.negativeHead}>
        <ShieldQuestion size={21} />
        <div>
          <p className="eyebrow">NOT ESTABLISHED</p>
          <h2>What this system has not concluded.</h2>
        </div>
      </div>
      <ul className={styles.negativeList}>
        {statements.map((statement) => (
          <li key={statement}>
            <Zap size={14} aria-hidden="true" />
            <span>{statement}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * What the receiving desk sees filling in while the transport is still moving.
 *
 * The countdown is scripted demo time, and it says so — the point is not the
 * number but the fact that the MIST fields beside it are populated before the
 * doors open rather than at them.
 */
export function PreArrival({
  time,
  duration,
  arrived,
  landed,
}: {
  time: number;
  duration: number;
  arrived: boolean;
  landed: { label: string; present: boolean }[];
}) {
  const remaining = Math.max(0, duration - time);
  const minutes = Math.ceil(remaining / 3);
  const progress = Math.min(100, (time / duration) * 100);
  const ready = landed.filter((item) => item.present).length;

  return (
    <div className={styles.countdown}>
      <div className={styles.countdownRow}>
        <strong>{arrived ? "Arrived" : `${minutes} min`}</strong>
        <span>
          {ready} of {landed.length} handoff fields populated before arrival
        </span>
      </div>
      <div className={styles.countdownTrack}>
        <div style={{ width: `${progress}%` }} />
      </div>
      <ul className={styles.draftBasis}>
        {landed.map((item) => (
          <li key={item.label}>
            {item.present ? "✓" : "◦"} {item.label}
          </li>
        ))}
      </ul>
      <p className={styles.countdownNote}>
        Scripted demonstration estimate, not a measured or dispatched ETA.
      </p>
    </div>
  );
}

/**
 * The model's proposed handoff text, offered for a person to take or leave.
 *
 * It is never written into the record by itself. Accepting copies it into the
 * editable form where a clinician owns it; the injuries field is not offered at
 * all, because no model output supports one.
 */
export function MistDraftCard({
  draft,
  onApply,
  onDismiss,
}: {
  draft: MistDraft;
  onApply: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className={styles.draft} role="region" aria-label="Unconfirmed model draft">
      <div className={styles.draftHead}>
        <Sparkles size={16} />
        <strong>Draft from scene evidence · unconfirmed</strong>
        <span className="tag">NOT A RECORD</span>
      </div>
      <dl className={styles.draftField}>
        {draft.mechanism && (
          <>
            <dt>Suggested mechanism</dt>
            <dd>{draft.mechanism}</dd>
          </>
        )}
        {draft.symptoms && (
          <>
            <dt>Suggested signs &amp; symptoms</dt>
            <dd>{draft.symptoms}</dd>
          </>
        )}
        <dt>Injuries</dt>
        <dd>
          Not drafted. A weapon in frame is not a wound and a person on the ground is not a
          diagnosis — this field is for a clinician only.
        </dd>
      </dl>
      {draft.basis.length > 0 && (
        <ul className={styles.draftBasis}>
          {draft.basis.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
      <div className={styles.draftActions}>
        <button type="button" onClick={onApply}>
          Copy into editable handoff
        </button>
        <button type="button" className="text-button" onClick={onDismiss}>
          Dismiss draft
        </button>
      </div>
    </div>
  );
}
