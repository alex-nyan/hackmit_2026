"use client";

import { useEffect, useState } from "react";
import { useAudioTranscription } from "../camera-triage/useAudioTranscription";
import { describeTranscript } from "../camera-triage/audio";
import type { IncidentDraft, IncidentEvent } from "../paw-patrol/incidents";
import { useIncidentBus, type BusStatus } from "../paw-patrol/useIncidentBus";
import { ACTION_LABELS, audioAssessmentLabel } from "./types";
import styles from "./AudioIntelligencePanel.module.css";
import { AudioSafetyAlerts } from "./AudioSafetyAlerts";

interface Configuration {
  provider: string;
  model: string;
  configured: boolean;
  transcription: string;
  incident_store: string;
  cloud: boolean;
}

const EXAMPLES = [
  ["Direct threat", "Officer, I have a gun and I will shoot you. Stay back."],
  ["Bomb / explosion", "There is a bomb in my car. It is going to explode."],
  ["Routine speech", "Officer, please confirm your location. I am at the station."],
  [
    "Quoted training",
    "In training yesterday, the instructor said, I will shoot you. This is only a training discussion.",
  ],
] as const;

export function AudioIntelligencePanel({
  events,
  status,
  publish,
  initialSource = "officer-P-01",
  expanded = false,
}: {
  events: IncidentEvent[];
  status: BusStatus;
  publish: (draft: IncidentDraft) => Promise<boolean>;
  initialSource?: string;
  expanded?: boolean;
}) {
  const [configuration, setConfiguration] = useState<Configuration | null>(null);
  const [source, setSource] = useState(initialSource);
  const [transcript, setTranscript] = useState<string>(EXAMPLES[0][1]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [now, setNow] = useState(0);
  const audio = useAudioTranscription(source);
  const recording =
    audio.state.state === "recording" || audio.state.state === "requesting-microphone";
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/audio-assess", { cache: "no-store", signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then(setConfiguration)
      .catch(() => undefined);
    const tick = () => setNow(Date.now());
    tick();
    const timer = setInterval(tick, 1000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, []);
  const assessments = events
    .filter(
      (event) =>
        event.audioAssessment &&
        !events.some((item) => item.audioSafetySignal?.assessment_id === event.id),
    )
    .slice(-6)
    .reverse();

  async function analyze() {
    setBusy(true);
    setMessage("Analyzing transcript…");
    try {
      const response = await fetch("/api/audio-assess", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: transcript,
          source_id: source,
          captured_at: new Date().toISOString(),
        }),
        signal: AbortSignal.timeout(55_000),
      });
      const result = await response.json();
      if (!response.ok) {
        setMessage(
          result.error === "audio-ai-not-configured"
            ? "Set AUDIO_AI_PROVIDER and its model credentials on the server."
            : `Assessment unavailable (${result.error ?? response.status}). No assessment was created.`,
        );
      } else
        setMessage(
          result.safety_publication === "failed"
            ? "Phrase alert could not be saved. Check the incident feed connection."
            : result.ai_error && result.safety_alert
              ? "Phrase alert shared; contextual AI is unavailable. Review the alert below."
              : result.publication === "published"
                ? "Assessment shared. Review the result below."
                : "AI answered, but the incident log could not save it. Check storage configuration.",
        );
    } catch {
      setMessage("Could not reach audio analysis. Check the server and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function acknowledge(event: IncidentEvent) {
    setReviewing(event.id);
    const ok = await publish({
      id: `review-${event.id}`,
      kind: "audio_review",
      origin: "operator",
      scenarioAt: null,
      personId: event.personId,
      source: "dispatch-audio-review",
      title: `Audio review acknowledged · ${event.personId ?? event.source}`,
      detail: `Dispatcher acknowledged ${event.id}. Recommendation: ${ACTION_LABELS[event.audioAssessment!.recommended_action]}. This records review only; no units have been dispatched.`,
      provenance: null,
      requiresHumanReview: false,
    });
    setMessage(
      ok
        ? "Review acknowledged across workspaces. No units dispatched."
        : "Could not save acknowledgment. Try again.",
    );
    setReviewing(null);
  }

  return (
    <section className={styles.panel} aria-label="Audio intelligence">
      <div className={styles.heading}>
        <div>
          <span className={styles.eyebrow}>LIVE AUDIO → AI → DISPATCH REVIEW</span>
          <h2>Audio intelligence</h2>
        </div>
        <span className={styles.connection} data-live={status === "live"}>
          {status === "live" ? "Shared feed connected" : "Feed disconnected"}
        </span>
      </div>
      <p className={styles.configuration}>
        {configuration?.configured
          ? `${configuration.provider} / ${configuration.model} configured`
          : "AI not configured"}
        {configuration &&
          ` · Speech: ${configuration.transcription} · Log: ${configuration.incident_store}`}
      </p>
      <details open={expanded} className={styles.controls}>
        <summary>Microphone & demo controls</summary>
        <p>
          Record independent 5-second clips. Each transcript is analyzed and shared with all
          workspaces.
        </p>
        {configuration?.cloud && (
          <p>
            Transcripts are sent to {configuration.provider}. Audio is transcribed by the configured
            speech service.
          </p>
        )}
        <label>
          Reporting source
          <input
            aria-label="Audio reporting source"
            value={source}
            maxLength={128}
            disabled={recording || busy}
            onChange={(event) => setSource(event.target.value)}
          />
        </label>
        <button
          className={styles.primary}
          disabled={!recording && (!source.trim() || busy)}
          onClick={() => (recording ? audio.stop() : void audio.start())}
        >
          {recording ? "Stop microphone" : "Start microphone only"}
        </button>
        {audio.state.state === "requesting-microphone" && (
          <p role="status">Waiting for microphone permission…</p>
        )}
        {audio.state.state === "unsupported" && <p role="alert">{audio.state.reason}</p>}
        {audio.state.state === "recording" && (
          <div aria-live="polite">
            <p>
              {audio.state.lastResult
                ? describeTranscript(audio.state.lastResult)
                : "Listening; first complete clip is sent after 5 seconds…"}
            </p>
            <p>{audio.state.analysisMessage}</p>
            <small>
              AI audio input: {audio.state.deviceLabel} · {audio.state.queuedClips ?? 0} clips
              queued
            </small>
            {audio.state.lastError && <p role="alert">{audio.state.lastError}</p>}
            {audio.state.coverageGap && <p role="alert">{audio.state.coverageGap}</p>}
          </div>
        )}
        <div className={styles.examples}>
          {EXAMPLES.map(([label, text]) => (
            <button key={label} disabled={busy} onClick={() => setTranscript(text)}>
              {label}
            </button>
          ))}
        </div>
        <label>
          Demo transcript — manually entered, not live audio
          <textarea
            aria-label="Demo transcript"
            rows={3}
            value={transcript}
            maxLength={4000}
            onChange={(event) => setTranscript(event.target.value)}
          />
        </label>
        <button
          disabled={busy || !transcript.trim() || !source.trim()}
          onClick={() => void analyze()}
        >
          {busy ? "Analyzing…" : "Analyze demo transcript"}
        </button>
      </details>
      {message && (
        <p role="status" className={styles.message}>
          {message}
        </p>
      )}
      <AudioSafetyAlerts events={events} status={status} publish={publish} />
      {!assessments.length && !events.some((event) => event.audioSafetySignal) && (
        <p className={styles.empty}>
          Waiting for an audio assessment. Start a microphone or analyze a demo transcript.
        </p>
      )}
      <div className={styles.results}>
        {assessments.map((event) => {
          const assessment = event.audioAssessment!;
          const age = Math.max(
            0,
            Math.floor((now - Date.parse(event.observedAt ?? event.at)) / 1000),
          );
          const stale = age > 120 || status !== "live";
          const reviewed = events.some((item) => item.id === `review-${event.id}`);
          return (
            <article key={event.id} className={styles.result} data-status={assessment.status}>
              <div className={styles.heading}>
                <strong>{audioAssessmentLabel(assessment)}</strong>
                <span>{Math.round(assessment.confidence * 100)}% confidence*</span>
              </div>
              <small>
                {event.source} ·{" "}
                {assessment.input_kind === "manual" ? "MANUAL DEMO INPUT" : "AUDIO CLIP TRANSCRIPT"}{" "}
                · {age}s ago{stale ? " · STALE / DISCONNECTED" : ""}
              </small>
              <blockquote>“{assessment.transcript}”</blockquote>
              <p>{assessment.summary}</p>
              <p className={styles.recommendation}>
                {ACTION_LABELS[assessment.recommended_action]}
              </p>
              <small>
                Evidence:{" "}
                {assessment.evidence.length
                  ? assessment.evidence.map((quote) => `“${quote}”`).join(" · ")
                  : "No supporting threat phrase"}
              </small>
              <small>Uncertainty: {assessment.uncertainty}</small>
              <div className={styles.heading}>
                <small>
                  {assessment.provider} / {assessment.model} ·{" "}
                  {(assessment.latency_ms / 1000).toFixed(1)}s
                </small>
                <button
                  disabled={reviewed || reviewing !== null || status !== "live"}
                  onClick={() => void acknowledge(event)}
                >
                  {reviewed
                    ? "Review acknowledged"
                    : reviewing === event.id
                      ? "Saving…"
                      : "Acknowledge review"}
                </button>
              </div>
            </article>
          );
        })}
      </div>
      <small className={styles.footnote}>
        *Uncalibrated model confidence in the classification, not probability of danger.
        Recommendations require dispatcher review; this demo does not send emergency services.
      </small>
    </section>
  );
}

export function AudioDemo() {
  const bus = useIncidentBus();
  return (
    <AudioIntelligencePanel
      events={bus.events}
      status={bus.status}
      publish={bus.publish}
      expanded
    />
  );
}
