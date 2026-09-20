"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Radio, HeartPulse } from "lucide-react";
import { BrandLogo } from "@/components/BrandLogo";
import {
  parseSessionInfo,
  type SessionInfo,
  type IncidentSnapshot,
  type IncidentCommand,
} from "../../shared/contracts";
import { useIncident } from "./useIncident";
import { LiveMap } from "./LiveMap";
import { EvidencePreview, MediaObservations } from "./MediaObservations";
import { HandoffPanel } from "./HandoffPanel";
import { effectiveFreshness, sourceAvailability } from "./freshness";
import styles from "./LiveWorkspace.module.css";

function date(value: string) {
  return new Date(value).toLocaleTimeString();
}
function age(seconds: number) {
  return seconds < 60
    ? `${Math.max(0, Math.floor(seconds))}s ago`
    : `${Math.floor(seconds / 60)}m ago`;
}
function readingStatus(
  reading: IncidentSnapshot["observations"][number],
  snapshot: IncidentSnapshot,
  connected: boolean,
  serverNow: number,
) {
  if (!connected) return "stale connection";
  const freshness = effectiveFreshness(reading, connected, serverNow);
  if (freshness !== "fresh") return freshness;
  const source = snapshot.sources.find((item) => item.source_id === reading.source_id);
  return source && sourceAvailability(source, connected, serverNow) === "available"
    ? "fresh"
    : "source unavailable";
}

export function LiveWorkspace() {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [incident, setIncident] = useState<string | null>(null);
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const authGeneration = useRef(0);
  function accept(value: unknown) {
    const next = parseSessionInfo(value);
    if (next.role === "source") throw new Error("An operator credential is required.");
    setSession(next);
    setIncident(next.incident_ids[0] ?? null);
  }
  useEffect(() => {
    const abort = new AbortController();
    const generation = authGeneration.current;
    void fetch("/api/live/session", {
      cache: "no-store",
      signal: AbortSignal.any([abort.signal, AbortSignal.timeout(10_000)]),
    })
      .then(async (r) => {
        if (r.ok) {
          const value: unknown = await r.json();
          if (!abort.signal.aborted && authGeneration.current === generation) accept(value);
        }
      })
      .catch(() => {});
    return () => abort.abort();
  }, []);
  async function signIn(event: FormEvent) {
    event.preventDefault();
    const generation = ++authGeneration.current;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/live/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok)
        throw new Error(
          "Sign-in unavailable or credential not authorized. Check the live service configuration.",
        );
      const value: unknown = await response.json();
      if (authGeneration.current !== generation) return;
      accept(value);
      setToken("");
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  }
  async function signOut() {
    ++authGeneration.current;
    try {
      const response = await fetch("/api/live/session", {
        method: "DELETE",
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error("sign_out_failed");
      setError("");
    } catch {
      setError(
        "Local view closed, but server sign-out was not confirmed. Close the browser or retry sign-in/sign-out when connected.",
      );
    } finally {
      setSession(null);
      setIncident(null);
    }
  }
  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <div>
          <h1>
            <BrandLogo /> Paw Patrol
          </h1>
          <p>Connected incident workspace · live data</p>
        </div>
        {session && (
          <div>
            <strong>
              {session.role} · {session.principal_id}
            </strong>
            <div className={styles.actions}>
              <button
                className={`${styles.button} ${styles.secondary}`}
                onClick={() => void signOut()}
              >
                Sign out
              </button>
            </div>
          </div>
        )}
      </header>
      <div className={styles.content}>
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        {!session ? (
          <section className={styles.panel}>
            <h2>Operator sign-in</h2>
            <p>Use your assigned incident credential. Workspace ports do not grant permissions.</p>
            <form className={styles.form} onSubmit={signIn}>
              <label>
                Operator credential
                <input
                  type="password"
                  autoComplete="off"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  required
                  minLength={32}
                  maxLength={256}
                />
              </label>
              <button className={styles.button} disabled={busy}>
                {busy ? "Verifying…" : "Connect to incidents"}
              </button>
            </form>
            <p className={styles.meta}>
              Credentials stay in an encrypted HttpOnly session. No live readings are replaced with
              demonstration data.
            </p>
          </section>
        ) : (
          <>
            <div className={styles.bar}>
              <label>
                Incident{" "}
                <select
                  className={styles.select}
                  value={incident ?? ""}
                  onChange={(e) => setIncident(e.target.value)}
                >
                  {session.incident_ids.map((id) => (
                    <option key={id}>{id}</option>
                  ))}
                </select>
              </label>
              <span className={styles.status}>Authenticated {session.role}</span>
            </div>
            {incident ? (
              <IncidentView
                key={`${session.principal_id}:${incident}`}
                incidentId={incident}
                session={session}
              />
            ) : (
              <p>No incidents assigned.</p>
            )}
          </>
        )}
      </div>
    </main>
  );
}

function IncidentView({ incidentId, session }: { incidentId: string; session: SessionInfo }) {
  const { snapshot, connection, error, pending, receivedAt, command } = useIncident(incidentId);
  const [now, setNow] = useState(() => Date.now());
  const [notice, setNotice] = useState("");
  const [note, setNote] = useState("");
  const [scope, setScope] = useState("");
  const [sceneStatus, setSceneStatus] = useState<"unknown" | "restricted" | "reported_clear">(
    "unknown",
  );
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  async function send(value: IncidentCommand) {
    setNotice("");
    if (await command(value)) setNotice("Action recorded by the incident service.");
  }
  const elapsed = receivedAt ? Math.max(0, (now - receivedAt) / 1000) : 0;
  const current = connection === "connected" && elapsed < 15;
  const serverNow = snapshot ? Date.parse(snapshot.generated_at) + elapsed * 1000 : now;
  return (
    <>
      <div className={styles.bar}>
        <span className={`${styles.status} ${!current ? styles.stale : ""}`}>
          <Radio size={16} />
          {current
            ? "Connected"
            : connection === "unauthorized"
              ? "Access unavailable"
              : "Updates unavailable"}
        </span>
        <span className={styles.meta}>
          {snapshot
            ? `Revision ${snapshot.revision} · snapshot ${date(snapshot.generated_at)}`
            : "Waiting for incident state"}
        </span>
      </div>
      {!current && (
        <p className={styles.warning}>
          Current coverage is not established. Retained readings and reports may be stale.
        </p>
      )}
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <section className={styles.panel}>
        <h2>Assistance</h2>
        <p>
          This requests help from the incident team. It does not call emergency services or Apple
          Emergency SOS.
        </p>
        <button
          className={`${styles.button} ${styles.assistance}`}
          disabled={pending || connection === "unauthorized"}
          onClick={() =>
            void send({
              kind: "assistance",
              note: "Operator requested assistance from the live workspace.",
            })
          }
        >
          Request team assistance
        </button>
      </section>
      {snapshot && (
        <>
          <section className={styles.panel}>
            <h2>Attention queue</h2>
            {snapshot.alerts.length === 0 ? (
              <p>No alerts recorded. This does not establish scene safety.</p>
            ) : (
              <ul className={styles.list}>
                {snapshot.alerts.map((alert) => (
                  <li key={alert.alert_id} className={`${styles.card} ${styles.alert}`}>
                    <div className={styles.bar}>
                      <h3>{alert.claim}</h3>
                      <span className={styles.status}>{alert.priority.replaceAll("_", " ")}</span>
                    </div>
                    <p className={styles.meta}>
                      {alert.source_id ?? alert.created_by?.principal_id ?? "Incident report"} ·
                      observed {date(alert.observed_at)} ·{" "}
                      {alert.evidence_status.replaceAll("_", " ")}
                    </p>
                    <p>
                      {alert.attention} · {alert.disposition.replaceAll("_", " ")} ·{" "}
                      {effectiveFreshness(alert, current, serverNow)}
                    </p>
                    {alert.evidence_refs.map((ref) => (
                      <EvidencePreview key={ref} evidenceId={ref} />
                    ))}
                    <div className={styles.actions}>
                      {alert.attention === "unacknowledged" && (
                        <button
                          className={styles.button}
                          disabled={pending || !current}
                          onClick={() =>
                            void send({
                              kind: "acknowledge",
                              alert_id: alert.alert_id,
                              expected_revision: snapshot.revision,
                            })
                          }
                        >
                          Acknowledge
                        </button>
                      )}
                      {session.role === "dispatch" && alert.disposition === "open" && (
                        <>
                          <button
                            className={`${styles.button} ${styles.secondary}`}
                            disabled={pending || !current || !note.trim()}
                            onClick={() =>
                              void send({
                                kind: "reject",
                                alert_id: alert.alert_id,
                                expected_revision: snapshot.revision,
                                note,
                              })
                            }
                          >
                            Reject with note
                          </button>
                          <button
                            className={`${styles.button} ${styles.secondary}`}
                            disabled={pending || !current || !note.trim()}
                            onClick={() =>
                              void send({
                                kind: "resolve",
                                alert_id: alert.alert_id,
                                expected_revision: snapshot.revision,
                                note,
                              })
                            }
                          >
                            Resolve with note
                          </button>
                        </>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <p className={styles.meta}>
              Acknowledgment records receipt. It does not establish truth or resolve the situation.
            </p>
            {session.role === "dispatch" && (
              <label className={styles.form}>
                Review note
                <textarea
                  maxLength={500}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Required for rejection, resolution, or a scene report"
                />
              </label>
            )}
          </section>
          <section className={styles.panel}>
            <h2>Source coverage</h2>
            <div className={styles.grid}>
              {snapshot.sources.map((source) => (
                <article className={styles.card} key={source.source_id}>
                  <h3>{source.display_name}</h3>
                  <span
                    className={`${styles.status} ${sourceAvailability(source, current, serverNow) !== "available" ? styles.stale : ""}`}
                  >
                    {!current ? "stale connection" : sourceAvailability(source, current, serverNow)}
                  </span>
                  <p className={styles.meta}>
                    {source.kind} · {source.source_id}
                    {source.wearer_id ? ` · ${source.wearer_role}: ${source.wearer_id}` : ""}
                  </p>
                  <p>{source.reason ?? "No device issue reported"}</p>
                  <p className={styles.meta}>
                    {source.age_seconds === null
                      ? "No measurement received"
                      : `Last source sample ${age(source.age_seconds + elapsed)}`}{" "}
                    · {source.sequence_gaps} sequence gaps
                  </p>
                </article>
              ))}
            </div>
          </section>
          <Readings snapshot={snapshot} elapsed={elapsed} current={current} />
          <MediaObservations snapshot={snapshot} connected={current} serverNow={serverNow} />
          {session.role !== "hospital" && (
            <section className={styles.panel}>
              <h2>Reported phone locations</h2>
              <LiveMap snapshot={snapshot} connected={current} serverNow={serverNow} />
            </section>
          )}
          <section className={styles.panel}>
            <h2>Human scene reports</h2>
            <p>
              Only an authorized human report can record scene access status. New evidence may
              require reassessment.
            </p>
            {snapshot.scene_reports.length ? (
              <ul className={styles.list}>
                {snapshot.scene_reports.map((report) => (
                  <li key={report.report_id} className={styles.card}>
                    <strong>
                      {report.status.replaceAll("_", " ")} · {report.scope}
                    </strong>
                    <p>{report.note}</p>
                    <p className={styles.meta}>
                      {report.reported_by.principal_id} · {date(report.reported_by.at)} · expires{" "}
                      {date(report.expires_at)}
                    </p>
                    <span className={styles.status}>
                      {report.reassessment_required
                        ? "Reassessment required"
                        : !current ||
                            !report.effective ||
                            new Date(report.expires_at).getTime() <= serverNow
                          ? "Not current"
                          : "Human report current"}
                    </span>
                    {session.role === "dispatch" && !report.revoked_by && (
                      <button
                        className={`${styles.button} ${styles.secondary}`}
                        disabled={pending || !current || !note.trim()}
                        onClick={() =>
                          void send({
                            kind: "revoke_scene_report",
                            report_id: report.report_id,
                            expected_revision: snapshot.revision,
                            note,
                          })
                        }
                      >
                        Revoke with review note
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p>Scene status unknown. No human report recorded.</p>
            )}
            {session.role === "dispatch" && (
              <form
                className={styles.form}
                onSubmit={(e) => {
                  e.preventDefault();
                  void send({
                    kind: "scene_report",
                    expected_revision: snapshot.revision,
                    status: sceneStatus,
                    scope,
                    note,
                    valid_for_seconds: 300,
                  });
                }}
              >
                <label>
                  Report status
                  <select
                    value={sceneStatus}
                    onChange={(e) => setSceneStatus(e.target.value as typeof sceneStatus)}
                  >
                    <option value="unknown">Unknown</option>
                    <option value="restricted">Restricted</option>
                    <option value="reported_clear">Human clearance reported</option>
                  </select>
                </label>
                <label>
                  Scope
                  <input
                    required
                    maxLength={300}
                    value={scope}
                    onChange={(e) => setScope(e.target.value)}
                    placeholder="Area and access covered by this report"
                  />
                </label>
                <p className={styles.meta}>Uses the review note above; expires in 5 minutes.</p>
                <button
                  className={styles.button}
                  disabled={pending || !current || !scope.trim() || !note.trim()}
                >
                  Record human report
                </button>
              </form>
            )}
          </section>
          {(session.role === "hospital" || session.role === "dispatch") && (
            <HandoffPanel
              snapshot={snapshot}
              current={current}
              pending={pending}
              command={command}
            />
          )}
        </>
      )}
    </>
  );
}

function Readings({
  snapshot,
  elapsed,
  current,
}: {
  snapshot: IncidentSnapshot;
  elapsed: number;
  current: boolean;
}) {
  const readings = snapshot.observations.filter(
    (o) => o.kind === "heart_rate" || o.kind === "location",
  );
  return (
    <section className={styles.panel}>
      <h2>
        <HeartPulse size={23} /> Measured observations
      </h2>
      {!readings.length && (
        <p>No accessible measurements. Unavailable data is not a normal reading.</p>
      )}
      <div className={styles.grid}>
        {readings.map((reading) => (
          <article className={styles.card} key={reading.observation_id}>
            <h3>{reading.subject_id ?? reading.source_id}</h3>
            {"bpm" in reading.value ? (
              <>
                <p className={styles.value}>
                  {reading.value.bpm} <small>bpm</small>
                </p>
                <p>Apple Watch · signal quality unknown</p>
              </>
            ) : "latitude" in reading.value ? (
              <>
                <p>
                  {reading.value.latitude.toFixed(5)}, {reading.value.longitude.toFixed(5)}
                </p>
                <p>
                  Phone location · accuracy ±{Math.round(reading.value.horizontal_accuracy_m)} m
                </p>
              </>
            ) : null}
            <span
              className={`${styles.status} ${readingStatus(reading, snapshot, current, Date.parse(snapshot.generated_at) + elapsed * 1000) !== "fresh" ? styles.stale : ""}`}
            >
              {readingStatus(
                reading,
                snapshot,
                current,
                Date.parse(snapshot.generated_at) + elapsed * 1000,
              )}{" "}
              · {age(reading.age_seconds + elapsed)}
            </span>
            <p className={styles.meta}>
              {reading.source_id} · measured {date(reading.measured_at)}
            </p>
            {reading.warnings.length > 0 && <p>{reading.warnings.join(" · ")}</p>}
          </article>
        ))}
      </div>
    </section>
  );
}
