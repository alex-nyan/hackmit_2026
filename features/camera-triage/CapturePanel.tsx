"use client";

import QRCode from "qrcode";
import { useCallback, useEffect, useRef, useState } from "react";

import { distressTerms, significantHazard } from "@/features/paw-patrol/hazardSignal";
import { useLiveTrack } from "@/features/live-track";
import { useLivePublisher } from "@/features/live-video";

import { describeTranscript, type TranscriptionResult } from "./audio";
import { hasLabels } from "./devices";
import type { TriageResult } from "./types";
import { useAudioTranscription } from "./useAudioTranscription";
import { useCameraTriage } from "./useCameraTriage";
import { useCaptureDevices } from "./useCaptureDevices";

interface CapturePanelProps {
  sourceId: string;
  /** Name shown beside the paired phone's green map marker. */
  displayName?: string;
  /** Open the preferred Continuity Camera as soon as this panel is shown. */
  autoStart?: boolean;
  /** Receives each accepted result so a workspace can publish it as an incident. */
  onResult?: (result: TriageResult) => void;
  onTranscript?: (result: TranscriptionResult) => void;
  /** Local iPhone-labelled preview readiness, not identity or server/AI delivery. */
  onPhoneConnectionChange?: (sourceId: string, connected: boolean) => void;
}

/**
 * Dashboard-sized capture. The full-page /capture view is for a phone held in
 * the hand; this is the same pipeline beside the map, which is how a Continuity
 * Camera is actually used: phone as the lens, laptop as the console.
 */
export function CapturePanel({
  sourceId,
  displayName,
  autoStart = false,
  onResult,
  onTranscript,
  onPhoneConnectionChange,
}: CapturePanelProps) {
  const { devices, cameraId, setCameraId, resolveDevices } = useCaptureDevices();

  const [escalation, setEscalation] = useState<string | null>(null);
  const [alertError, setAlertError] = useState("");
  const escalationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const escalate = useCallback((reason: string) => {
    setEscalation(reason);
    if (escalationTimer.current) clearTimeout(escalationTimer.current);
    escalationTimer.current = setTimeout(() => setEscalation(null), 30_000);
  }, []);
  useEffect(
    () => () => {
      if (escalationTimer.current) clearTimeout(escalationTimer.current);
    },
    [],
  );
  const { state, videoRef, start, stop, stream } = useCameraTriage({
    sourceId,
    intervalMs: escalation ? 500 : 4000,
    onResult: (result) => {
      if (significantHazard(result)) escalate("Camera hazard needs review");
      onResult?.(result);
    },
  });
  const { watchers } = useLivePublisher(sourceId, stream);
  const liveTrack = useLiveTrack(stream !== null);
  const audio = useAudioTranscription(
    sourceId,
    (result) => {
      if (result.speech_detected && result.text && distressTerms(result.text).length)
        escalate("Audio concern needs review");
      onTranscript?.(result);
    },
    {
      urgent: escalation !== null,
      onSpike: () => {
        escalate("Sudden audio spike — cause unknown");
        void fetch("/api/incidents", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: `audio-spike-${crypto.randomUUID()}`,
            kind: "hazard",
            origin: "model",
            scenarioAt: null,
            personId: sourceId,
            source: sourceId,
            observedAt: new Date().toISOString(),
            title: `Audio spike · unverified · ${sourceId}`,
            detail:
              "Local microphone level rose sharply. Cause unknown; this is not a gunshot classification. Review footage and contact the officer. Scene access remains unconfirmed.",
            provenance: { provider: "browser", model: "rms-change-detector", confidence: null },
            requiresHumanReview: true,
          }),
        })
          .then((response) => {
            setAlertError(response.ok ? "" : "Audio spike alert could not reach the shared log.");
          })
          .catch(() => setAlertError("Audio spike alert could not reach the shared log."));
      },
    },
  );
  const running = state.state === "running";
  const busy = running || state.state === "requesting-camera";
  const listening =
    audio.state.state === "recording" || audio.state.state === "requesting-microphone";
  const deviceLabel = state.state === "running" ? state.deviceLabel : "";

  useEffect(() => {
    if (!onPhoneConnectionChange) return;
    let lastReported: boolean | undefined;
    const deliver = (connected: boolean) => {
      if (lastReported === connected) return;
      lastReported = connected;
      try {
        onPhoneConnectionChange(sourceId, connected);
      } catch {
        // A view-only observer must never interrupt capture or its cleanup.
      }
    };
    const video = videoRef.current;
    const stream =
      typeof MediaStream !== "undefined" && video?.srcObject instanceof MediaStream
        ? video.srcObject
        : null;
    const tracks = stream?.getVideoTracks() ?? [];
    if (!running || !/iphone/i.test(deviceLabel) || !video || !stream || !tracks.length) {
      deliver(false);
      return;
    }
    let blocked = false;
    let previousPosition = video.currentTime;
    let lastAdvance = Number.NEGATIVE_INFINITY;
    const report = () => {
      const now = performance.now();
      const position = video.currentTime;
      if (Number.isFinite(position) && position > previousPosition) lastAdvance = now;
      else if (!Number.isFinite(position) || position < previousPosition)
        lastAdvance = Number.NEGATIVE_INFINITY;
      previousPosition = position;
      // A playing element alone is not evidence of a fresh preview. Require its
      // media clock to advance, and turn the indicator off after three seconds.
      deliver(
        Boolean(
          !blocked &&
          now - lastAdvance <= 3_000 &&
          video.srcObject === stream &&
          video.readyState >= 2 &&
          !video.paused &&
          !video.ended &&
          !video.error &&
          tracks.some((track) => track.readyState === "live" && track.enabled && !track.muted),
        ),
      );
    };
    const block = () => {
      blocked = true;
      lastAdvance = Number.NEGATIVE_INFINITY;
      deliver(false);
    };
    const playing = () => {
      blocked = false;
      previousPosition = video.currentTime;
      lastAdvance = Number.NEGATIVE_INFINITY;
      report();
    };
    const trackChanged = () => {
      previousPosition = video.currentTime;
      lastAdvance = Number.NEGATIVE_INFINITY;
      report();
    };
    const blockedVideoEvents = ["waiting", "stalled", "pause", "ended", "emptied", "error"];
    const trackEvents = ["ended", "mute", "unmute"];
    blockedVideoEvents.forEach((event) => video.addEventListener(event, block));
    video.addEventListener("playing", playing);
    video.addEventListener("timeupdate", report);
    tracks.forEach((track) =>
      trackEvents.forEach((event) => track.addEventListener(event, trackChanged)),
    );
    const watchdog = setInterval(report, 250);
    report();
    return () => {
      clearInterval(watchdog);
      blockedVideoEvents.forEach((event) => video.removeEventListener(event, block));
      video.removeEventListener("playing", playing);
      video.removeEventListener("timeupdate", report);
      tracks.forEach((track) =>
        trackEvents.forEach((event) => track.removeEventListener(event, trackChanged)),
      );
      deliver(false);
    };
  }, [deviceLabel, onPhoneConnectionChange, running, sourceId, videoRef]);

  const startedAutomatically = useRef(false);

  const startCamera = useCallback(async () => {
    // Permission is what reveals device names, so the phone can only be
    // preferred over the built-in webcam once the list has been asked for.
    const chosen = await resolveDevices({ microphone: true });
    await Promise.all([start(chosen.cameraId), audio.start(chosen.microphoneId)]);
  }, [resolveDevices, start, audio.start]);

  useEffect(() => {
    if (!autoStart || startedAutomatically.current) return;
    startedAutomatically.current = true;
    void startCamera();
  }, [autoStart, startCamera]);

  const selected = devices.cameras.find((device) => device.deviceId === cameraId);
  const pairedLocation =
    liveTrack.state === "tracking"
      ? liveTrack.devices.find(
          (device) => device.id === sourceId && device.fix?.freshness === "live",
        )
      : undefined;

  return (
    <aside className="capture-card" aria-label="Camera">
      <span className="capture-card__eyebrow">{displayName ?? sourceId} · Camera</span>
      <p className="capture-card__note">
        Start prefers your iPhone Continuity Camera and microphone when macOS makes them available.
        Allow camera and microphone access; check the active device below.
      </p>
      <p className="capture-card__note" role="status">
        {escalation
          ? `Heightened analysis · ${escalation}`
          : listening
            ? "AI standby · listening for audio changes and distress terms"
            : "AI listening off"}
      </p>
      {escalation && (
        <p className="capture-card__note">
          Faster frame review and shorter audio clips for 30 seconds after the latest trigger.
          Alerts are shared with this workspace’s officers and dispatch.
        </p>
      )}
      {alertError && <p className="capture-card__error">{alertError}</p>}

      <video
        ref={videoRef}
        className="capture-card__video"
        data-live={busy ? "true" : undefined}
        playsInline
        muted
        autoPlay
      />

      {devices.cameras.length > 1 && hasLabels(devices.cameras) && (
        <select
          className="capture-card__picker"
          value={cameraId ?? ""}
          onChange={(event) => setCameraId(event.target.value || null)}
          disabled={busy}
          aria-label="Camera source"
        >
          <option value="">Default camera</option>
          {devices.cameras.map((device) => (
            <option key={device.deviceId} value={device.deviceId}>
              {device.label || "Camera"}
            </option>
          ))}
        </select>
      )}

      <div className="capture-card__actions">
        <button
          type="button"
          className="capture-card__button"
          data-stop={busy ? "true" : undefined}
          onClick={() => {
            if (busy) {
              stop();
              audio.stop();
              setEscalation(null);
            } else void startCamera();
          }}
        >
          {busy || listening ? "Stop camera & audio" : "Start camera & AI listening"}
        </button>
        <button
          type="button"
          className="capture-card__button capture-card__button--quiet"
          data-on={listening ? "true" : undefined}
          onClick={() => (listening ? audio.stop() : void audio.start())}
        >
          {listening ? "Mute" : "Listen"}
        </button>
      </div>

      {!busy && selected && <p className="capture-card__note">Selected: {selected.label}</p>}

      {/* Name the camera that is actually open: a body camera running on the
          laptop's own lens looks identical to one running on the phone. */}
      {running && state.deviceLabel && (
        <p className="capture-card__note">Live on {state.deviceLabel}</p>
      )}

      {running && watchers > 0 && (
        <p className="capture-card__note">
          Streaming live to {watchers} {watchers === 1 ? "dashboard" : "dashboards"}
        </p>
      )}

      {
        <PhoneLocationPairing
          sourceId={sourceId}
          displayName={displayName ?? sourceId}
          publishing={Boolean(pairedLocation)}
        />
      }

      {audio.state.state === "requesting-microphone" && (
        <p className="capture-card__note">Waiting for microphone permission…</p>
      )}

      {state.state === "unsupported" && <p className="capture-card__error">{state.reason}</p>}
      {state.state === "denied" && <p className="capture-card__error">{state.reason}</p>}
      {audio.state.state === "unsupported" && (
        <p className="capture-card__error">{audio.state.reason}</p>
      )}

      {running && state.lastError && <p className="capture-card__error">{state.lastError}</p>}

      {/* No triage service behind this deployment. Worth saying once, plainly:
          the capture is still working and still feeding the wall. */}
      {running && !state.triageConfigured && (
        <p className="capture-card__note">
          No hazard triage configured here. Frames are still publishing to the body camera wall.
        </p>
      )}

      {running && state.lastResult && (
        <div className="capture-card__result">
          <span className="capture-card__priority" data-level={state.lastResult.review_priority}>
            {state.lastResult.review_priority.replace(/_/g, " ")}
          </span>
          <p>{state.lastResult.assessment?.summary ?? "No assessment returned."}</p>
        </div>
      )}

      {audio.state.state === "recording" && (
        <div className="capture-card__result">
          <span className="capture-card__eyebrow">Heard</span>
          {audio.state.lastError ? (
            <p className="capture-card__error">{audio.state.lastError}</p>
          ) : (
            <p>
              {audio.state.lastResult ? describeTranscript(audio.state.lastResult) : "Listening…"}
            </p>
          )}
        </div>
      )}

      {(running || audio.state.state === "recording") && (
        // The service never clears a scene, and a transcript is a guess.
        <p className="capture-card__caveat">Model output for a person to review, not a decision.</p>
      )}
    </aside>
  );
}

/**
 * Continuity Camera gives the Mac a video device, not the iPhone's GPS. The
 * phone therefore opens this short link itself and publishes with the exact
 * same source id as the camera. Map clicks can then resolve to this stream.
 */
function PhoneLocationPairing({
  sourceId,
  displayName,
  publishing,
}: {
  sourceId: string;
  displayName: string;
  publishing: boolean;
}) {
  const [qrSvg, setQrSvg] = useState<string | null>(null);
  const [link, setLink] = useState("");

  useEffect(() => {
    const url = new URL("/join", window.location.origin);
    url.searchParams.set("sourceId", sourceId);
    url.searchParams.set("name", displayName);
    const next = url.toString();
    let cancelled = false;
    setLink(next);

    void QRCode.toString(next, {
      type: "svg",
      errorCorrectionLevel: "Q",
      margin: 1,
      color: { dark: "#0d1216ff", light: "#ffffffff" },
    })
      .then((svg) => {
        if (!cancelled) setQrSvg(svg);
      })
      .catch(() => {
        if (!cancelled) setQrSvg(null);
      });

    return () => {
      cancelled = true;
    };
  }, [displayName, sourceId]);

  return (
    <div className="capture-card__location">
      {qrSvg && (
        <div
          className="capture-card__location-code"
          role="img"
          aria-label="QR code to pair this phone's location with the live camera"
          dangerouslySetInnerHTML={{ __html: qrSvg }}
        />
      )}
      <div>
        <p className="capture-card__location-title" data-publishing={publishing || undefined}>
          {publishing ? "Location live · visible to other officers" : "Pair this phone's GPS"}
        </p>
        <p className="capture-card__note">
          Scan with the phone serving Continuity Camera, then tap “Put me on the map”. Its green
          marker opens this camera for other officers.
        </p>
        {link && <code className="capture-card__location-link">{link}</code>}
      </div>
    </div>
  );
}
