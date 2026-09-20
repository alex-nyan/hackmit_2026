"use client";

import type { MistEntry, MistSection } from "./mistHandoff";
import styles from "./HospitalMistHandoff.module.css";

/** A compact handoff view of received statements, not generated clinical findings. */
export function HospitalMistHandoff({ sections }: { sections: MistSection[] }) {
  return (
    <div className={styles.handoff}>
      <div className={styles.grid}>
        {sections.map((section) => (
          <section key={section.id} className={styles.card} aria-label={section.title}>
            <header>
              <span className={styles.code}>{section.code}</span>
              <h3>{section.title}</h3>
            </header>
            <dl>
              {section.fields.map((field) => (
                <div key={field.id} className={styles.field}>
                  <dt>{field.label}</dt>
                  <dd>
                    {field.entries.length ? (
                      field.entries.map((entry) => <Entry key={entry.id} entry={entry} />)
                    ) : (
                      <span className={styles.unknown}>Not reported</span>
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </div>
  );
}

function Entry({ entry }: { entry: MistEntry }) {
  const time =
    entry.at && Number.isFinite(Date.parse(entry.at))
      ? new Date(entry.at).toISOString().slice(11, 19)
      : null;
  const source = entry.source.includes("Local operator note")
    ? "Local note · not shared"
    : entry.source.startsWith("Audio transcript")
      ? `Audio · ${entry.sourceId}`
      : entry.source.startsWith("Video report")
        ? `Camera · ${entry.sourceId}`
        : entry.source.startsWith("Shared vital snapshot")
          ? `Shared reading · ${entry.sourceId}`
          : entry.source.startsWith("Operator report")
            ? `Operator · ${entry.sourceId}`
            : entry.source.startsWith("Sample")
              ? `Sample · ${entry.sourceId}`
              : entry.source;
  return (
    <article className={styles.entry} data-priority={entry.priority} data-state={entry.state}>
      <p>{entry.text}</p>
      <div className={styles.meta}>
        <span title={entry.source}>{source}</span>
        {entry.state === "sample" ? (
          <span className={styles.tag}>DEMO</span>
        ) : entry.state === "stale" ? (
          <span className={styles.tag}>STALE</span>
        ) : null}
        {entry.review && <span className={styles.tag}>Unverified</span>}
        {entry.confidence !== null && (
          <span title="Source model score, not a clinical probability">
            Score {Math.round(entry.confidence * 100)}%
          </span>
        )}
        {time && <time dateTime={entry.at!}>{time} UTC</time>}
      </div>
    </article>
  );
}
