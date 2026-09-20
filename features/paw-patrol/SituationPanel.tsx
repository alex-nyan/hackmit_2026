"use client";

import { useEffect, useRef, useState } from "react";
import { HeartRatePanel } from "../heart-rate/HeartRatePanel";
import type { HeartRateConnection } from "../heart-rate/useHeartRate";
import type { IncidentDraft, IncidentEvent } from "./incidents";
import type { BusStatus } from "./useIncidentBus";
import styles from "./SituationPanel.module.css";

export function SituationPanel({
  events,
  status,
  publish,
  personId,
  heartRate,
  inline = false,
  hideEmptyObservation = false,
}: {
  inline?: boolean;
  hideEmptyObservation?: boolean;
  events: IncidentEvent[];
  status: BusStatus;
  publish: (draft: IncidentDraft) => Promise<boolean>;
  personId: string;
  heartRate: HeartRateConnection;
}) {
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState(personId);
  const [now, setNow] = useState(0);
  const [report, setReport] = useState("");
  const [responseNotes, setResponseNotes] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef<IncidentDraft | null>(null);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const sources = [
    ...new Set([personId, ...events.flatMap((e) => (e.personId ? [e.personId] : []))]),
  ];
  const related = events
    .filter((e) => e.personId === source && e.origin !== "script")
    .slice()
    .reverse();
  const current = related.filter((e) => {
    const age = now - Date.parse(e.observedAt ?? e.at);
    return status === "live" && age >= 0 && age <= (e.kind === "vitals" ? 30_000 : 60_000);
  });
  const camera = current.find((e) => e.kind === "hazard" || e.kind === "observation");
  const audio = current.find((e) => e.kind === "transcript");
  const vitals = current.find((e) => e.kind === "vitals");
  const canShare =
    source === personId &&
    heartRate.mode === "device" &&
    heartRate.status === "receiving" &&
    heartRate.bpm !== null &&
    heartRate.receivedAt !== null &&
    now - heartRate.receivedAt < 30_000;
  async function send(draft: IncidentDraft) {
    setBusy(true);
    if (
      pending.current?.detail !== draft.detail ||
      pending.current?.personId !== draft.personId ||
      pending.current?.kind !== draft.kind
    )
      pending.current = draft;
    const ok = await publish(pending.current);
    if (ok) pending.current = null;
    setBusy(false);
    setMessage(
      ok
        ? "Saved to the shared workspace log. No external medic service contacted."
        : "Could not save. Your draft is retained; retry when connected.",
    );
  }
  const modelEvents = events
    .slice()
    .reverse()
    .filter((event) => event.origin === "model");
  const recentConcern = modelEvents.find((event) => {
    const age = now - Date.parse(event.observedAt ?? event.at);
    return (
      age >= 0 &&
      age <= 60_000 &&
      (event.kind === "hazard" || event.title.startsWith("Audio concern"))
    );
  });
  const latest = recentConcern ?? modelEvents[0];
  const latestAge = latest ? now - Date.parse(latest.observedAt ?? latest.at) : Infinity;
  const fresh = status === "live" && latestAge >= 0 && latestAge <= 60_000;
  const concern = fresh && (latest?.kind === "hazard" || latest?.title.startsWith("Audio concern"));
  return (
    <>
      {(!hideEmptyObservation || latest !== undefined) && (
        <aside
          className={styles.knowledge}
          data-inline={inline}
          data-concern={concern}
          aria-label="Latest observation"
        >
          <small>
            Latest observation
            {!hideEmptyObservation && ` · ${fresh ? "Recent" : "No current report"}`}
          </small>
          <strong>
            {status !== "live"
              ? "Situation updates disconnected"
              : !latest
                ? "Waiting for a camera or audio report"
                : !fresh
                  ? "Last report is out of date"
                  : latest.title}
          </strong>
          {(!hideEmptyObservation || fresh) && (
            <p>
              {fresh ? latest?.detail : "No recent camera or audio reports. Scene status unknown."}
            </p>
          )}
          {latest && (
            <small>
              Source {latest.personId} · {latest.observedAt ?? latest.at}
            </small>
          )}
          <button
            onClick={() => {
              const nextSource = latest?.personId ?? personId;
              if (nextSource !== source) {
                setReport("");
                setMessage("");
              }
              setSource(nextSource);
              setOpen(true);
            }}
          >
            Review report
          </button>
        </aside>
      )}
      {open && (
        <section className={styles.panel} role="dialog" aria-label="Situation and medic report">
          <header>
            <h2>Situation & medic report</h2>
            <button onClick={() => setOpen(false)} aria-label="Close situation">
              Close
            </button>
          </header>
          <p>
            Verify camera and audio reports before acting. Heart rate is linked to the selected
            wearer and is not an injury assessment.
          </p>
          <label>
            Source / assigned profile
            <select
              value={source}
              onChange={(e) => {
                setSource(e.target.value);
                setReport("");
                setMessage("");
              }}
            >
              {sources.map((id) => (
                <option key={id}>{id}</option>
              ))}
            </select>
          </label>
          <p role="status">
            {status === "live"
              ? "Shared log connected"
              : "Shared log unavailable — evidence may be incomplete"}
          </p>
          <h3>
            {camera?.kind === "hazard" || audio?.title.startsWith("Audio concern")
              ? "Situation needs human review"
              : "Situation context — assessment pending"}
          </h3>
          {(
            [
              ["Camera", camera],
              ["Audio", audio],
              ["Heart rate", vitals],
            ] as const
          ).map(([label, event]) => (
            <article key={label}>
              <strong>{label}</strong>
              <p>{event?.detail ?? "No recent shared observation. Coverage unknown."}</p>
              {event && (
                <small>
                  {event.source} · {event.observedAt ?? event.at} ·{" "}
                  {event.provenance
                    ? `${event.provenance.provider}/${event.provenance.model}`
                    : "Operator-shared device snapshot"}
                </small>
              )}
            </article>
          ))}
          <button
            disabled={!canShare || busy}
            onClick={() => {
              if (!canShare || heartRate.receivedAt === null) return;
              void send({
                id: `vitals-${personId}-${heartRate.receivedAt}`,
                kind: "vitals",
                origin: "operator",
                scenarioAt: null,
                personId,
                observedAt: new Date(heartRate.receivedAt).toISOString(),
                title: `Heart-rate snapshot · ${personId}`,
                detail: `${heartRate.bpm} bpm from ${heartRate.deviceName ?? "Bluetooth device"}. Browser receipt time ${new Date(heartRate.receivedAt).toISOString()}. Wearer assigned by operator; not independently verified.`,
                source: "Operator-shared Bluetooth",
                provenance: null,
                requiresHumanReview: true,
              });
            }}
          >
            Share current heart rate for {personId}
          </button>
          <p>
            Sharing saves this one reading to the log visible in all workspaces. Connect HeartCast
            in Devices first. No automatic heart-rate alerts.
          </p>
          {source === personId && (
            <HeartRatePanel
              connection={heartRate}
              personId={personId}
              personName="Operator-assigned wearer"
              compact
            />
          )}
          <h3>Response coordination</h3>
          <p>
            Confirm the location and contact the reporting officer. Record observed descriptions and
            direction of travel without inferring identity. Follow your agency’s approved SOP; this
            checklist is a coordination aid.
          </p>
          <p>
            Medical need and scene access remain unknown until a responder confirms them. A quiet
            feed never clears the scene.
          </p>
          <label>
            Confirmed details / location / access route
            <textarea
              rows={3}
              maxLength={400}
              value={responseNotes}
              onChange={(event) => setResponseNotes(event.target.value)}
              placeholder="Who confirmed this, where, and when? Include observed injuries or suspect description if reported."
            />
          </label>
          {(
            [
              [
                "acknowledge",
                "Request dispatch review",
                "Dispatch review requested; verify the evidence and contact the reporting officer.",
              ],
              [
                "mist",
                "Request medic staging",
                "Medic staging requested. Scene entry is NOT authorized; access remains unconfirmed.",
              ],
              [
                "scene",
                "Report scene access confirmed",
                "Operator reports scene access confirmed. Reconfirm conditions with incident command before entry.",
              ],
            ] as const
          ).map(([kind, title, detail]) => (
            <button
              key={title}
              disabled={busy || !responseNotes.trim() || status !== "live"}
              onClick={() =>
                void send({
                  id: `response-${crypto.randomUUID()}`,
                  kind,
                  origin: "operator",
                  scenarioAt: null,
                  personId: source,
                  title: `${title} · ${source}`,
                  detail:
                    `${detail} Reporting operator: ${personId}. ${responseNotes.trim()}`.slice(
                      0,
                      600,
                    ),
                  source: "Operator-reviewed response coordination",
                  provenance: null,
                  requiresHumanReview: true,
                })
              }
            >
              {title}
            </button>
          ))}
          <p>
            These actions publish to the shared officer, dispatch and hospital workspaces. They do
            not contact an external dispatch or EMS system.
          </p>
          <h3>Medic report draft</h3>
          <button
            onClick={() => {
              setReport(
                [
                  `Source ${source}. Unverified scene context:`,
                  `Camera: ${camera?.detail.slice(0, 150) ?? "Unknown"}`,
                  `Audio: ${audio?.detail.slice(0, 130) ?? "Unknown"}`,
                  `HR: ${vitals?.detail.slice(0, 140) ?? "Unknown"}`,
                  "Injuries / treatments: not reported. Scene access: unconfirmed.",
                ]
                  .join("\n")
                  .slice(0, 600),
              );
              setMessage("");
            }}
          >
            Prepare from current evidence
          </button>
          <label>
            Review and edit before sharing
            <textarea
              rows={8}
              maxLength={600}
              value={report}
              onChange={(e) => setReport(e.target.value)}
            />
          </label>
          <button
            disabled={!report.trim() || busy}
            onClick={() =>
              void send({
                id: `medic-${crypto.randomUUID()}`,
                kind: "mist",
                origin: "operator",
                scenarioAt: null,
                personId: source,
                title: `Medic report · ${source}`,
                detail: report.trim(),
                source: "Operator-reviewed situation report",
                provenance: null,
                requiresHumanReview: true,
              })
            }
          >
            Save reviewed report to workspaces
          </button>
          <p role="status">{message}</p>
          <h3>Recent reports & evidence history</h3>
          {related.slice(0, 12).map((event) => (
            <article key={event.id}>
              <strong>{event.title}</strong>
              <p>{event.detail}</p>
              <small>
                {event.observedAt ?? event.at} · {event.source} · historical record
              </small>
            </article>
          ))}
        </section>
      )}
    </>
  );
}
