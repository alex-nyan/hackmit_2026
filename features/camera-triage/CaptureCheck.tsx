"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import { RECORDER_MIME_CANDIDATES, pickRecorderMimeType, toServiceMediaType } from "./audio";
import { trackConstraint } from "./devices";
import { useCaptureDevices } from "./useCaptureDevices";
import styles from "./CaptureCheck.module.css";

const CLIP_MS = 5000;

interface CheckSession {
  stream: MediaStream | null;
  context: AudioContext | null;
  frame: number | null;
  recorder: MediaRecorder | null;
  timer: ReturnType<typeof setTimeout> | null;
}

function releaseSession(session: CheckSession) {
  if (session.timer !== null) clearTimeout(session.timer);
  if (session.frame !== null) cancelAnimationFrame(session.frame);
  if (session.recorder) {
    session.recorder.ondataavailable = null;
    session.recorder.onstop = null;
    session.recorder.onerror = null;
    try {
      if (session.recorder.state !== "inactive") session.recorder.stop();
    } catch {
      // A failed recorder must not prevent releasing the capture devices.
    }
  }
  void session.context?.close().catch(() => undefined);
  session.stream?.getTracks().forEach((track) => {
    track.onended = null;
    track.stop();
  });
}

/** What this browser can do, before anyone is asked for permission. */
interface Capabilities {
  /** The scheme and host actually in the address bar, to tell apart the two
   * ways a page fails this check: plain HTTP, and HTTPS the device distrusts. */
  origin: string;
  secureContext: boolean;
  hasMediaDevices: boolean;
  hasMediaRecorder: boolean;
  supportedFormats: string[];
  chosenFormat: string | null;
}

/** What the test actually found once permission was granted. */
interface Findings {
  videoTrack: string | null;
  audioTrack: string | null;
  clipBytes: number | null;
  clipType: string | null;
  error: string | null;
}

const EMPTY: Findings = {
  videoTrack: null,
  audioTrack: null,
  clipBytes: null,
  clipType: null,
  error: null,
};

const SERVER_CAPABILITIES: Capabilities = {
  origin: "",
  secureContext: false,
  hasMediaDevices: false,
  hasMediaRecorder: false,
  supportedFormats: [],
  chosenFormat: null,
};

// Cached because useSyncExternalStore requires a stable snapshot reference, and
// these values cannot change for the life of the page.
let cachedCapabilities: Capabilities | null = null;

function readCapabilities(): Capabilities {
  if (cachedCapabilities) return cachedCapabilities;
  const hasRecorder = typeof MediaRecorder !== "undefined";
  cachedCapabilities = {
    origin: typeof window !== "undefined" ? window.location.origin : "",
    secureContext: typeof window !== "undefined" && window.isSecureContext,
    hasMediaDevices: Boolean(navigator?.mediaDevices?.getUserMedia),
    hasMediaRecorder: hasRecorder,
    supportedFormats: hasRecorder
      ? RECORDER_MIME_CANDIDATES.filter((candidate) => MediaRecorder.isTypeSupported(candidate))
      : [],
    chosenFormat: hasRecorder
      ? pickRecorderMimeType((candidate) => MediaRecorder.isTypeSupported(candidate))
      : null,
  };
  return cachedCapabilities;
}

const neverChanges = () => () => {};

/**
 * Proves the device will hand over camera and microphone, with no network calls
 * at all. Separating this from the triage page matters on a phone: otherwise a
 * capture failure and a service failure look identical.
 */
export function CaptureCheck() {
  const capabilities = useSyncExternalStore(
    neverChanges,
    readCapabilities,
    () => SERVER_CAPABILITIES,
  );
  const [findings, setFindings] = useState<Findings>(EMPTY);
  const [running, setRunning] = useState(false);
  const [level, setLevel] = useState(0);
  const [playbackUrl, setPlaybackUrl] = useState<string | null>(null);
  const { devices, cameraId, microphoneId, setCameraId, setMicrophoneId, refreshDevices } =
    useCaptureDevices();

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const sessionRef = useRef<CheckSession | null>(null);

  const stop = useCallback(() => {
    const session = sessionRef.current;
    sessionRef.current = null;
    if (session) releaseSession(session);
    if (videoRef.current) videoRef.current.srcObject = null;
    setRunning(false);
    setLevel(0);
  }, []);

  const start = useCallback(async () => {
    if (sessionRef.current) return;
    // Reserve the session before permission so Stop can cancel a pending grant.
    const session: CheckSession = {
      stream: null,
      context: null,
      frame: null,
      recorder: null,
      timer: null,
    };
    sessionRef.current = session;
    setRunning(true);
    // Keep the selectors aligned with this acquisition when permission reveals labels.
    setCameraId(cameraId);
    setMicrophoneId(microphoneId);
    setFindings(EMPTY);
    setPlaybackUrl(null);
    const fail = (error: string) => {
      if (sessionRef.current !== session) return;
      stop();
      setFindings((current) => ({ ...current, error }));
    };

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: trackConstraint(cameraId),
        audio: trackConstraint(microphoneId),
      });
      if (sessionRef.current !== session) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      session.stream = stream;
      stream.getTracks().forEach((track) => {
        track.onended = () => fail("Camera or microphone capture ended. Test again to reconnect.");
      });
      // Labels are only exposed after permission is granted, so list again now.
      void refreshDevices();

      const [video] = stream.getVideoTracks();
      const [audio] = stream.getAudioTracks();
      setFindings((current) => ({
        ...current,
        videoTrack: video ? video.label || "unnamed camera" : null,
        audioTrack: audio ? audio.label || "unnamed microphone" : null,
      }));

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }
      if (sessionRef.current !== session) return;

      // A live level meter is the only way to tell a working mic from a muted
      // one; permission being granted says nothing about audio actually flowing.
      const context = new AudioContext();
      session.context = context;
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      context.createMediaStreamSource(stream).connect(analyser);
      const samples = new Uint8Array(analyser.frequencyBinCount);

      const tick = () => {
        if (sessionRef.current !== session) return;
        analyser.getByteTimeDomainData(samples);
        let peak = 0;
        for (const sample of samples) peak = Math.max(peak, Math.abs(sample - 128));
        setLevel(Math.min(1, peak / 96));
        session.frame = requestAnimationFrame(tick);
      };
      tick();

      // Record a short clip and play it back locally, so the test covers
      // recording and not merely permission.
      const mimeType =
        typeof MediaRecorder === "undefined"
          ? null
          : pickRecorderMimeType((candidate) => MediaRecorder.isTypeSupported(candidate));
      if (mimeType) {
        // The formats above are audio containers; do not include the video track.
        const recorder = new MediaRecorder(new MediaStream(stream.getAudioTracks()), { mimeType });
        session.recorder = recorder;
        const chunks: BlobPart[] = [];
        recorder.ondataavailable = (event) => {
          if (sessionRef.current === session && event.data.size > 0) chunks.push(event.data);
        };
        recorder.onerror = () => fail("Audio recording failed. Test again to retry.");
        recorder.onstop = () => {
          if (sessionRef.current !== session) return;
          session.recorder = null;
          recorder.ondataavailable = null;
          recorder.onstop = null;
          recorder.onerror = null;
          const blob = new Blob(chunks, { type: recorder.mimeType || mimeType });
          setFindings((current) => ({
            ...current,
            clipBytes: blob.size,
            clipType: blob.type || mimeType,
          }));
          setPlaybackUrl(URL.createObjectURL(blob));
        };
        recorder.start();
        session.timer = setTimeout(() => {
          session.timer = null;
          if (sessionRef.current !== session) return;
          try {
            if (recorder.state !== "inactive") recorder.stop();
          } catch {
            fail("Audio recording failed. Test again to retry.");
          }
        }, CLIP_MS);
      }
    } catch (error) {
      const name = error instanceof Error ? error.name : "";
      fail(
        name === "NotAllowedError"
          ? "Permission was declined for the camera or microphone."
          : name === "NotFoundError"
            ? "No camera or microphone was found."
            : `Capture failed (${name || "unknown error"}).`,
      );
    }
  }, [cameraId, microphoneId, refreshDevices, setCameraId, setMicrophoneId, stop]);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.hidden) stop();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      stop();
    };
  }, [stop]);

  useEffect(() => {
    return () => {
      if (playbackUrl) URL.revokeObjectURL(playbackUrl);
    };
  }, [playbackUrl]);

  const yes = (value: boolean) => (
    <span className={value ? styles.ok : styles.bad}>{value ? "yes" : "no"}</span>
  );

  return (
    <main className={styles.root}>
      <h1 className={styles.title}>Capture check</h1>
      <p className={styles.sub}>
        Tests only whether this device will hand over its camera and microphone. Nothing is
        uploaded.
      </p>

      {!capabilities.secureContext && (
        <p className={styles.warn}>
          This page is not in a secure context, so the browser will refuse the camera and
          microphone. Open it over HTTPS, or on localhost.
        </p>
      )}

      <label className={styles.pickerLabel} htmlFor="camera">
        Camera
      </label>
      <select
        id="camera"
        className={styles.picker}
        value={cameraId ?? ""}
        onChange={(event) => setCameraId(event.target.value || null)}
        disabled={running}
      >
        <option value="">Default camera</option>
        {devices.cameras.map((device) => (
          <option key={device.deviceId} value={device.deviceId}>
            {device.label || "Camera (allow access to see its name)"}
          </option>
        ))}
      </select>

      <label className={styles.pickerLabel} htmlFor="microphone">
        Microphone
      </label>
      <select
        id="microphone"
        className={styles.picker}
        value={microphoneId ?? ""}
        onChange={(event) => setMicrophoneId(event.target.value || null)}
        disabled={running}
      >
        <option value="">Default microphone</option>
        {devices.microphones.map((device) => (
          <option key={device.deviceId} value={device.deviceId}>
            {device.label || "Microphone (allow access to see its name)"}
          </option>
        ))}
      </select>

      <button
        type="button"
        className={styles.secondaryButton}
        onClick={() => void refreshDevices()}
        disabled={running}
      >
        Rescan for devices
      </button>

      <button
        type="button"
        className={styles.button}
        data-stop={running ? "true" : undefined}
        onClick={() => (running ? stop() : void start())}
        disabled={!capabilities.hasMediaDevices}
      >
        {running ? "Stop" : "Test camera and microphone"}
      </button>

      <video ref={videoRef} className={styles.video} playsInline muted autoPlay />

      {running && (
        <div className={styles.meterWrap}>
          <div className={styles.meter}>
            <div className={styles.meterFill} style={{ width: `${Math.round(level * 100)}%` }} />
          </div>
          <p className={styles.sub} style={{ margin: "6px 0 0" }}>
            Say something: this bar moves only if audio is actually flowing.
          </p>
        </div>
      )}

      {playbackUrl && (
        <audio className={styles.playback} src={playbackUrl} controls preload="metadata" />
      )}

      {findings.error && <p className={styles.warn}>{findings.error}</p>}

      <dl className={styles.rows}>
        <div className={styles.row}>
          <dt>Address</dt>
          <dd>{capabilities.origin || "…"}</dd>
        </div>
        <div className={styles.row}>
          <dt>Secure context</dt>
          <dd>{yes(capabilities.secureContext)}</dd>
        </div>
        <div className={styles.row}>
          <dt>getUserMedia</dt>
          <dd>{yes(capabilities.hasMediaDevices)}</dd>
        </div>
        <div className={styles.row}>
          <dt>MediaRecorder</dt>
          <dd>{yes(capabilities.hasMediaRecorder)}</dd>
        </div>
        <div className={styles.row}>
          <dt>Camera</dt>
          <dd>{findings.videoTrack ?? "not tested"}</dd>
        </div>
        <div className={styles.row}>
          <dt>Microphone</dt>
          <dd>{findings.audioTrack ?? "not tested"}</dd>
        </div>
        <div className={styles.row}>
          <dt>Recordable formats</dt>
          <dd>{capabilities.supportedFormats.join(", ") || "none"}</dd>
        </div>
        <div className={styles.row}>
          <dt>Would send as</dt>
          <dd>
            {capabilities.chosenFormat
              ? `${capabilities.chosenFormat} → ${toServiceMediaType(capabilities.chosenFormat)}`
              : "no usable format"}
          </dd>
        </div>
        <div className={styles.row}>
          <dt>5s clip</dt>
          <dd>
            {findings.clipBytes === null
              ? "not recorded"
              : `${Math.round(findings.clipBytes / 1024)} KB · ${findings.clipType}`}
          </dd>
        </div>
      </dl>
    </main>
  );
}
