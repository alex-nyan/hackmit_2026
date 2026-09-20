"use client";

import { useState } from "react";
import type { HumanHandoff, IncidentCommand, IncidentSnapshot } from "../../shared/contracts";
import styles from "./LiveWorkspace.module.css";

const FIELDS = [
  ["mechanism", "Mechanism / reported event"],
  ["injuries", "Reported injuries"],
  ["signs", "Measured or reported clinical signs"],
  ["treatments", "Reported treatment"],
] as const;
type Field = (typeof FIELDS)[number][0];
type Draft = Record<Field, string>;

export function HandoffPanel({
  snapshot,
  current,
  pending,
  command,
}: {
  snapshot: IncidentSnapshot;
  current: boolean;
  pending: boolean;
  command: (value: IncidentCommand) => Promise<boolean>;
}) {
  const [selected, setSelected] = useState("");
  const patient =
    snapshot.patients.find((item) => item.patient_id === selected) ?? snapshot.patients[0];
  const latest = patient
    ? snapshot.handoffs
        .filter((item) => item.patient_id === patient.patient_id)
        .sort((a, b) => b.handoff_revision - a.handoff_revision)[0]
    : undefined;
  return (
    <section className={styles.panel}>
      <h2>Patient handoff · human report</h2>
      <p>
        Record mechanism, injuries, signs, and treatment for an explicitly assigned patient. Blank
        fields remain “not reported.”
      </p>
      {!patient ? (
        <p>
          No patient record is assigned to this credential. Patient enrollment is configured by the
          incident administrator.
        </p>
      ) : (
        <>
          <label className={styles.form}>
            Patient record
            <select
              value={patient.patient_id}
              onChange={(event) => setSelected(event.target.value)}
            >
              {snapshot.patients.map((item) => (
                <option key={item.patient_id} value={item.patient_id}>
                  {item.display_name} · {item.patient_id}
                </option>
              ))}
            </select>
          </label>
          {latest && (
            <article className={styles.card}>
              <h3>Latest recorded handoff · revision {latest.handoff_revision}</h3>
              {FIELDS.map(([field, label]) => (
                <p key={field}>
                  <strong>{label}:</strong> {latest[field] ?? "Not reported"}
                </p>
              ))}
              <p className={styles.meta}>
                Reported by {latest.recorded_by.principal_id} at{" "}
                {new Date(latest.recorded_by.at).toLocaleString()}. Recorded locally; no external
                handoff was sent.
              </p>
            </article>
          )}
          <HandoffEditor
            key={patient.patient_id}
            patientId={patient.patient_id}
            latest={latest}
            revision={snapshot.revision}
            current={current}
            pending={pending}
            command={command}
          />
        </>
      )}
      <p className={styles.meta}>
        Watch heart rate is supplemental wearer telemetry and is never copied into this form. Blood
        pressure, oxygen saturation, and breathing rate are not supplied by this Watch integration.
      </p>
    </section>
  );
}

function HandoffEditor({
  patientId,
  latest,
  revision,
  current,
  pending,
  command,
}: {
  patientId: string;
  latest: HumanHandoff | undefined;
  revision: number;
  current: boolean;
  pending: boolean;
  command: (value: IncidentCommand) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState<Draft>({
    mechanism: "",
    injuries: "",
    signs: "",
    treatments: "",
  });
  const [message, setMessage] = useState("");
  const [draftRevision, setDraftRevision] = useState<number | null>(null);
  const latestRevision = latest?.handoff_revision ?? 0;
  const changedSinceDraft = draftRevision !== null && draftRevision !== latestRevision;
  const hasContent = FIELDS.some(([field]) => draft[field].trim());
  return (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault();
        if (changedSinceDraft || pending || !current) return;
        setMessage("");
        void command({
          kind: "submit_handoff",
          expected_revision: revision,
          patient_id: patientId,
          mechanism: draft.mechanism.trim() || null,
          injuries: draft.injuries.trim() || null,
          signs: draft.signs.trim() || null,
          treatments: draft.treatments.trim() || null,
        }).then((confirmed) => {
          if (confirmed) {
            setDraft({ mechanism: "", injuries: "", signs: "", treatments: "" });
            setDraftRevision(null);
            setMessage("Human handoff recorded locally. No external delivery was requested.");
          }
        });
      }}
    >
      <h3>New reviewed handoff</h3>
      {latest && (
        <button
          className={`${styles.button} ${styles.secondary}`}
          type="button"
          onClick={() => {
            setDraft({
              mechanism: latest.mechanism ?? "",
              injuries: latest.injuries ?? "",
              signs: latest.signs ?? "",
              treatments: latest.treatments ?? "",
            });
            setDraftRevision(latestRevision);
            setMessage(
              "Copied the latest human report. Review every field before recording a new version.",
            );
          }}
        >
          Use latest human report as draft
        </button>
      )}
      {FIELDS.map(([field, label]) => (
        <label key={field}>
          {label}
          <textarea
            value={draft[field]}
            disabled={pending}
            maxLength={1000}
            placeholder="Not reported"
            onChange={(event) => {
              if (draftRevision === null) setDraftRevision(latestRevision);
              setDraft({ ...draft, [field]: event.target.value });
            }}
          />
        </label>
      ))}
      <p className={styles.meta}>
        Record only observations or reports you can attribute. This saves a complete new version for{" "}
        {patientId}; blank fields are unknown in that version.
      </p>
      {changedSinceDraft && (
        <p role="alert" className={styles.warning}>
          A newer handoff was recorded while you edited. Review the latest record above and copy it
          to a new draft before submitting.
        </p>
      )}
      <button
        className={styles.button}
        disabled={!current || pending || !hasContent || changedSinceDraft}
      >
        Record reviewed handoff
      </button>
      {message && <p role="status">{message}</p>}
    </form>
  );
}
