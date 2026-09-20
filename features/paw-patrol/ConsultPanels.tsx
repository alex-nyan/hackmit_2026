"use client";
import { useState, type Dispatch } from "react";
import { AlertTriangle, ShieldCheck, Siren } from "lucide-react";
import {
  AVPU,
  bloodPressure,
  emptyMist,
  emsStatus,
  mistText,
  validateMist,
  type MistRecord,
  type PanicReport,
  type SceneReport,
} from "./consult";
import type { MistDraft } from "./draftMist";
import { sampleHeartRate, stamp, type Person } from "./scenario";
import type { DemoAction } from "./useScenario";
import styles from "./ConsultPanels.module.css";

export function SceneCoordination({
  time,
  scene,
  person,
  panics,
  command,
  dispatch,
}: {
  time: number;
  scene: SceneReport;
  person: Person;
  panics: PanicReport[];
  command: boolean;
  dispatch: Dispatch<DemoAction>;
}) {
  return (
    <section
      className={`${styles.scene} ${scene.status === "unsafe" ? styles.unsafe : ""}`}
      aria-label="Scene access and assistance"
    >
      <div className={styles.sceneSummary}>
        {scene.status === "cleared" ? <ShieldCheck size={23} /> : <AlertTriangle size={23} />}
        <div>
          <strong>Scene {scene.status === "cleared" ? "clearance reported" : scene.status}</strong>
          <small>
            {scene.source} · {stamp(scene.at)} · simulation
          </small>
        </div>
        <div>
          <strong>EMS · {emsStatus(time, scene.status)}</strong>
          <small>Assignment does not authorize entry. Clearance is a separate report.</small>
        </div>
      </div>
      <div className={styles.actions}>
        {command && (
          <>
            <button onClick={() => dispatch({ type: "scene", status: "unsafe" })}>
              Mark unsafe
            </button>
            <button onClick={() => dispatch({ type: "scene", status: "unknown" })}>
              Status unknown
            </button>
            <button onClick={() => dispatch({ type: "scene", status: "cleared" })}>
              Record demo clearance
            </button>
          </>
        )}
        <button
          className={styles.panic}
          disabled={panics.some((p) => p.personId === person.id)}
          onClick={() => dispatch({ type: "panic", personId: person.id })}
        >
          <Siren size={16} /> Demo panic · {person.id}
        </button>
      </div>
      <p>
        Panic requests assistance and pauses this demo. It does not establish an injury or
        diagnosis.
      </p>
      {panics.map((p) => (
        <div key={p.personId} className={styles.alert} role="status">
          <strong>
            {p.personId} · assistance requested at {stamp(p.at)}
          </strong>
          <span>
            {p.acknowledgedAt === null
              ? "Awaiting command acknowledgement"
              : `Acknowledged at ${stamp(p.acknowledgedAt)}`}
          </span>
          {command && p.acknowledgedAt === null && (
            <button onClick={() => dispatch({ type: "acknowledge", personId: p.personId })}>
              Acknowledge {p.personId}
            </button>
          )}
        </div>
      ))}
    </section>
  );
}

export type TacticalReport = { clothing: string; items: string; location: string; notes: string };
export const emptyTactical: TacticalReport = { clothing: "", items: "", location: "", notes: "" };
export function TacticalBrief({
  report,
  setReport,
}: {
  time: number;
  report: TacticalReport;
  setReport: (report: TacticalReport) => void;
}) {
  return (
    <section className={styles.tactical} aria-label="Tactical subject report">
      <h3>Subject description</h3>
      <p>Operator-entered observations.</p>
      <dl>
        <div>
          <dt>Clothing / appearance</dt>
          <dd>{report.clothing || "Not described"}</dd>
        </div>
        <div>
          <dt>Visible items</dt>
          <dd>{report.items || "Not reported"}</dd>
        </div>
        <div>
          <dt>Last observed location</dt>
          <dd>{report.location || "Not reported"}</dd>
        </div>
      </dl>
      <details>
        <summary>Record a demo subject description</summary>
        <p>No identity or threat conclusion is inferred from appearance.</p>
        {(
          [
            ["clothing", "Clothing / appearance"],
            ["items", "Visible items"],
            ["location", "Last observed location"],
            ["notes", "Observation time / source / uncertainty"],
          ] as const
        ).map(([key, label]) => (
          <label key={key}>
            {label}
            <input
              value={report[key]}
              maxLength={240}
              onChange={(e) => setReport({ ...report, [key]: e.target.value })}
            />
          </label>
        ))}
        <small>
          Operator-entered simulation notes · {report.notes || "Source/time not supplied"}
        </small>
      </details>
    </section>
  );
}

export function MistHandoff({
  person,
  time,
  scene,
  saved,
  seed,
  onSave,
}: {
  person: Person;
  time: number;
  scene: SceneReport;
  saved?: MistRecord;
  /**
   * Unconfirmed model text a person chose to pull into the form. It seeds the
   * editable fields and nothing else: it is never saved, never shown as the
   * record, and the reporter stays whoever presses save.
   */
  seed?: MistDraft | null;
  onSave: (record: MistRecord) => void;
}) {
  const [draft, setDraft] = useState<MistRecord>(() => {
    const base = saved ?? emptyMist(time);
    if (!seed) return base;
    return {
      ...base,
      mechanism: seed.mechanism || base.mechanism,
      symptoms: seed.symptoms || base.symptoms,
      // Injuries is deliberately never seeded. See draftMist.ts.
    };
  });
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");
  const [copyFallback, setCopyFallback] = useState(false);
  const record = saved ?? emptyMist(time);
  const text = mistText(person, record, sampleHeartRate(person.id, time), time, scene);
  function field<K extends keyof MistRecord>(key: K, value: MistRecord[K]) {
    setDraft({ ...draft, [key]: value });
    setError("");
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied("Demo handoff copied. No external recipient contacted.");
    } catch {
      setCopyFallback(true);
      setCopied("Select and copy the handoff below.");
    }
  }
  return (
    <section className={`panel ${styles.mist}`} aria-label="MIST clinical handoff">
      <div className={styles.title}>
        <div>
          <p className="eyebrow">SIMULATED MIST · {person.id}</p>
          <h2>One structured handoff.</h2>
        </div>
        <span className="tag">NO LIVE VITALS</span>
      </div>
      <div className={styles.mistGrid}>
        <article>
          <b>M</b>
          <h3>Mechanism</h3>
          <p>{record.mechanism || "Not reported"}</p>
        </article>
        <article>
          <b>I</b>
          <h3>Injuries reported</h3>
          <p>{record.injuries || "Site and severity not described. No diagnosis inferred."}</p>
        </article>
        <article>
          <b>S</b>
          <h3>Signs & symptoms</h3>
          <dl>
            <div>
              <dt>Heart rate</dt>
              <dd>{sampleHeartRate(person.id, time)} bpm · synthetic</dd>
            </div>
            <div>
              <dt>Blood pressure</dt>
              <dd>{bloodPressure(record)}</dd>
            </div>
            <div>
              <dt>Pulse assessment</dt>
              <dd>
                {record.pulse}
                {record.pulseSite && ` · ${record.pulseSite}`}
              </dd>
            </div>
            <div>
              <dt>AVPU</dt>
              <dd>{record.consciousness}</dd>
            </div>
          </dl>
          <p>{record.symptoms || "Other signs not recorded"}</p>
        </article>
        <article>
          <b>T</b>
          <h3>Treatments / interventions</h3>
          <p>{record.treatments || "Not recorded — do not assume none."}</p>
        </article>
      </div>
      <p className={styles.note}>
        Record: {record.reporter} · {stamp(record.at)}. Heart rate does not establish blood
        pressure. Report observed findings; this demo provides no treatment recommendations.
      </p>
      <details>
        <summary>Edit simulated handoff observations</summary>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const issue = validateMist(draft);
            if (issue) {
              setError(issue);
              return;
            }
            onSave({
              ...draft,
              systolic: draft.bpMethod === "Not measured" ? "" : draft.systolic,
              diastolic: draft.bpMethod === "Cuff" ? draft.diastolic : "",
              reporter: "Demo operator",
              at: time,
            });
            setCopied("");
          }}
        >
          <div className={styles.formGrid}>
            <label>
              Mechanism
              <input
                maxLength={400}
                value={draft.mechanism}
                onChange={(e) => field("mechanism", e.target.value)}
              />
            </label>
            <label>
              Injuries reported
              <input
                maxLength={400}
                value={draft.injuries}
                onChange={(e) => field("injuries", e.target.value)}
                placeholder="Unknown unless reported"
              />
            </label>
            <label>
              BP measurement method
              <select
                value={draft.bpMethod}
                onChange={(e) => field("bpMethod", e.target.value as MistRecord["bpMethod"])}
              >
                {["Not measured", "Cuff", "Palpated systolic"].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
            <label>
              Systolic · mmHg
              <input
                inputMode="numeric"
                maxLength={3}
                disabled={draft.bpMethod === "Not measured"}
                value={draft.systolic}
                onChange={(e) => field("systolic", e.target.value)}
              />
            </label>
            <label>
              Diastolic · mmHg
              <input
                inputMode="numeric"
                maxLength={3}
                disabled={draft.bpMethod !== "Cuff"}
                value={draft.diastolic}
                onChange={(e) => field("diastolic", e.target.value)}
              />
            </label>
            <label>
              Pulse assessment
              <select
                value={draft.pulse}
                onChange={(e) => field("pulse", e.target.value as MistRecord["pulse"])}
              >
                {["Not assessed", "Present", "Absent"].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
            <label>
              Pulse assessment site
              <input
                maxLength={80}
                value={draft.pulseSite}
                onChange={(e) => field("pulseSite", e.target.value)}
                placeholder="Only if assessed"
              />
            </label>
            <label>
              Consciousness · AVPU
              <select
                value={draft.consciousness}
                onChange={(e) =>
                  field("consciousness", e.target.value as MistRecord["consciousness"])
                }
              >
                {AVPU.map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
            <label>
              Other signs / symptoms
              <textarea
                maxLength={600}
                value={draft.symptoms}
                onChange={(e) => field("symptoms", e.target.value)}
              />
            </label>
            <label>
              Treatments / interventions performed
              <textarea
                maxLength={600}
                value={draft.treatments}
                onChange={(e) => field("treatments", e.target.value)}
                placeholder="Document only what was performed in the simulation"
              />
            </label>
          </div>
          {error && <p role="alert">{error}</p>}
          <button className="secondary" type="submit">
            Save demo observations
          </button>
        </form>
      </details>
      <div className={styles.actions}>
        <button className="secondary" onClick={copy}>
          Copy demo MIST
        </button>
        <span role="status">{copied || "Local session only · reset clears observations"}</span>
      </div>
      {copyFallback && (
        <textarea
          aria-label="Copyable demo MIST"
          readOnly
          value={text}
          rows={9}
          onFocus={(e) => e.target.select()}
        />
      )}
    </section>
  );
}
