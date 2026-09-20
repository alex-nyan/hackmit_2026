"use client";

import { useId, useMemo, useState } from "react";
import { Backpack, Eye, MapPin, Radio, ScanEye, ShieldAlert, Shirt } from "lucide-react";
import { byNewest, describeOrigin, type IncidentEvent } from "./incidents";
import { PEOPLE } from "./scenario";
import type { BusStatus } from "./useIncidentBus";
import styles from "./OfficerIncidentBriefing.module.css";

interface Props {
  events: IncidentEvent[];
  busStatus: BusStatus;
  personId: string;
  onLocate: (id: string) => void;
  demo: boolean;
}

const SAMPLE_OBSERVATIONS = [
  { label: "Dark jacket", category: "Clothing", score: "0.94", icon: Shirt, review: false },
  {
    label: "Black backpack",
    category: "Carried item",
    score: "0.88",
    icon: Backpack,
    review: false,
  },
  {
    label: "Object inconclusive",
    category: "Needs review",
    score: "0.42",
    icon: ScanEye,
    review: true,
  },
] as const;

function ReportTime({ at }: { at: string }) {
  const milliseconds = Date.parse(at);
  if (!Number.isFinite(milliseconds)) return <span>Time unavailable</span>;
  const date = new Date(milliseconds).toISOString();
  return (
    <time dateTime={date}>
      {date.slice(0, 10)} · {date.slice(11, 19)} UTC
    </time>
  );
}

/** Read-only received context. Selection cannot assign a unit or approve a model claim. */
export function OfficerIncidentBriefing(props: Props) {
  return <BriefingContext key={props.personId} {...props} />;
}

function BriefingContext({ events, busStatus, personId, onLocate, demo }: Props) {
  const headingId = useId();
  const contextId = useId();
  const [selection, setSelection] = useState<{ officerId: string; reportId: string } | null>(null);
  const newest = useMemo(() => [...events].sort(byNewest), [events]);
  const officerEvents = newest.filter((event) => event.personId === personId);
  // A profile change invalidates a previous explicit choice. Removed records do
  // not silently substitute an unrelated report into the briefing.
  const explicitId = selection?.officerId === personId ? selection.reportId : "";
  const latestContext = officerEvents.find((event) => event.origin === "model") ?? officerEvents[0];
  const selected = explicitId ? newest.find((event) => event.id === explicitId) : latestContext;
  const contextPersonId = explicitId ? selected?.personId : personId;
  const requests = newest
    .filter(
      (event) =>
        contextPersonId &&
        event.personId === contextPersonId &&
        (event.kind === "panic" || event.kind === "acknowledge"),
    )
    .slice(0, 4);
  const score = selected?.provenance?.confidence;
  const hasScore = typeof score === "number" && Number.isFinite(score) && score >= 0 && score <= 1;
  const review = selected?.origin === "model" || selected?.requiresHumanReview;
  const showSample = demo && !selected && !explicitId;
  const connected = busStatus === "live";

  return (
    <section className={styles.briefing} aria-labelledby={headingId}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>
            <Eye size={14} aria-hidden="true" /> INCIDENT CONTEXT
          </p>
          <h2 id={headingId}>Inference information</h2>
        </div>
        <span className={styles.connection} data-connected={connected} role="status">
          <Radio size={12} aria-hidden="true" />
          {connected ? "Log connected" : busStatus === "connecting" ? "Connecting" : "Log offline"}
        </span>
      </header>

      <div className={styles.context}>
        <label htmlFor={contextId}>Report context</label>
        <select
          id={contextId}
          value={explicitId}
          onChange={(event) => setSelection({ officerId: personId, reportId: event.target.value })}
        >
          <option value="">
            {personId} · latest {latestContext?.origin === "model" ? "model output" : "report"}
          </option>
          {explicitId && !selected && (
            <option value={explicitId}>Selected report unavailable</option>
          )}
          {newest.map((event) => (
            <option key={event.id} value={event.id}>
              {event.personId ?? "Unscoped"} · {event.title} · {event.id}
            </option>
          ))}
        </select>
        <span className={styles.assignment}>No assignment received</span>
      </div>

      {!connected && (
        <p className={styles.offline} role="status">
          <ShieldAlert size={14} aria-hidden="true" />
          Updates are unconfirmed. Displayed records may be old; this is not an all-clear.
        </p>
      )}

      <div className={styles.body}>
        <div className={styles.observations}>
          {selected ? (
            <article className={styles.report} data-review={review}>
              <div className={styles.reportHeading}>
                <span className={styles.origin} data-model={selected.origin === "model"}>
                  {describeOrigin(selected)}
                </span>
                <span className={styles.kind}>{selected.kind}</span>
              </div>
              <h3>{selected.title}</h3>
              <p className={styles.detail}>{selected.detail}</p>
              <div className={styles.reportMetrics}>
                <div>
                  <span>Model score</span>
                  <strong>
                    {selected.origin === "model" && hasScore ? score.toFixed(2) : "—"}
                  </strong>
                  <small>
                    {selected.origin === "model"
                      ? "Uncalibrated · not a probability"
                      : "Not a model observation"}
                  </small>
                </div>
                <div>
                  <span>Recorded</span>
                  <strong className={styles.recorded}>
                    <ReportTime at={selected.at} />
                  </strong>
                  <small>{selected.personId ?? "No officer association supplied"}</small>
                </div>
              </div>
              <dl className={styles.provenance}>
                <div>
                  <dt>Source</dt>
                  <dd>{selected.source}</dd>
                </div>
                {selected.provenance && (
                  <div>
                    <dt>Model</dt>
                    <dd>
                      {selected.provenance.provider} · {selected.provenance.model}
                    </dd>
                  </div>
                )}
              </dl>
              {review && (
                <p className={styles.reviewNote}>
                  <ShieldAlert size={14} aria-hidden="true" /> Human review required. No assignment
                  or scene clearance implied.
                </p>
              )}
            </article>
          ) : showSample ? (
            <div className={styles.sample}>
              <div className={styles.sampleHeading}>
                <span>UI SAMPLE</span>
                <strong>Visual observation preview</strong>
              </div>
              <p>Illustrative only · not received data about {personId} or an incident.</p>
              <ul className={styles.sampleList} aria-label="Sample observations, not model output">
                {SAMPLE_OBSERVATIONS.map(
                  ({ label, category, score: exampleScore, icon: Icon, review: needsReview }) => (
                    <li key={label} data-review={needsReview}>
                      <span>
                        <Icon size={15} aria-hidden="true" /> {category}
                      </span>
                      <strong>{label}</strong>
                      <b>
                        {exampleScore}
                        <small>example score</small>
                      </b>
                    </li>
                  ),
                )}
              </ul>
              <p className={styles.reviewNote}>
                <ShieldAlert size={14} aria-hidden="true" /> Sample scores are not certainty. Model
                observations require human review.
              </p>
            </div>
          ) : (
            <div className={styles.empty}>
              <ScanEye size={30} strokeWidth={1.4} aria-hidden="true" />
              <h3>{explicitId ? "Selected report unavailable" : "No received context"}</h3>
              <p>
                {explicitId
                  ? "Choose another report explicitly. Nothing has been substituted."
                  : `No observation or report has been received for ${personId}.`}
              </p>
            </div>
          )}
        </div>

        <aside
          className={styles.requests}
          aria-label="Recent assistance reports in selected context"
        >
          <div className={styles.requestsHeading}>
            <ShieldAlert size={15} aria-hidden="true" />
            <h3>Recent alerts</h3>
            <span>{requests.length}</span>
          </div>
          <p className={styles.scope}>
            {contextPersonId
              ? `${contextPersonId} · assistance history`
              : "No officer association in this context"}
          </p>
          {requests.length ? (
            <ul>
              {requests.map((event) => (
                <li key={event.id}>
                  <span className={styles.requestKind}>
                    {event.kind === "panic"
                      ? "Assistance requested"
                      : "Acknowledged · not resolved"}
                  </span>
                  <strong>{event.title}</strong>
                  <small>{describeOrigin(event)}</small>
                  <small>
                    <ReportTime at={event.at} />
                  </small>
                  {event.personId && PEOPLE.some((person) => person.id === event.personId) && (
                    <button
                      type="button"
                      title="Locate the demo roster position, not the incident location"
                      onClick={() => onLocate(event.personId!)}
                    >
                      <MapPin size={13} aria-hidden="true" /> Locate {event.personId} on demo map
                    </button>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <div className={styles.requestEmpty}>
              No assistance reports in this context.<small>Not a safety assessment.</small>
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}
