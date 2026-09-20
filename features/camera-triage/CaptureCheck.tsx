"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import { RECORDER_MIME_CANDIDATES, pickRecorderMimeType, toServiceMediaType } from "./audio";
import {
  NO_DEVICES,
  findContinuityDevice,
  splitDevices,
  trackConstraint,
  type CaptureDevices,
} from "./devices";
import styles from "./CaptureCheck.module.css";

const CLIP_MS = 5000;

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
  const [devices, setDevices] = useState<CaptureDevices>(NO_DEVICES);
  const [cameraId, setCameraId] = useState<string | null>(null);
  const [microphoneId, setMicrophoneId] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const frameRef = useRef<number | null>(null);

  /**
   * Re-reads the device list. Continuity Camera appears and disappears as the
   * phone becomes eligible, so this is deliberately callable at any time.
   */
  const refreshDevices = useCallback(async () => {
    if (!navigator?.mediaDevices?.enumerateDevices) return NO_DEVICES;
    const found = splitDevices(await navigator.mediaDevices.enumerateDevices());
    setDevices(found);
    // Prefer the phone when it is there; the built-in webcam wins otherwise.
    setCameraId((current) => current ?? findContinuityDevice(found.cameras)?.deviceId ?? null);
    setMicrophoneId(
      (current) => current ?? findContinuityDevice(found.microphones)?.deviceId ?? null,
    );
    return found;
  }, []);

  const stop = useCallback(() => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    void audioContextRef.current?.close();
    audioContextRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setRunning(false);
    setLevel(0);
  }, []);

  const start = useCallback(async () => {
    setFindings((current) => ({ ...current, error: null, clipBytes: null, clipType: null }));
    setPlaybackUrl(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: trackConstraint(cameraId),
        audio: trackConstraint(microphoneId),
      });
      // Labels are only exposed after permission is granted, so list again now.
      void refreshDevices();
      streamRef.current = stream;
      setRunning(true);

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

      // A live level meter is the only way to tell a working mic from a muted
      // one; permission being granted says nothing about audio actually flowing.
      const context = new AudioContext();
      audioContextRef.current = context;
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      context.createMediaStreamSource(stream).connect(analyser);
      const samples = new Uint8Array(analyser.frequencyBinCount);

      const tick = () => {
        analyser.getByteTimeDomainData(samples);
        let peak = 0;
        for (const sample of samples) peak = Math.max(peak, Math.abs(sample - 128));
        setLevel(Math.min(1, peak / 96));
        frameRef.current = requestAnimationFrame(tick);
      };
      tick();

      // Record a short clip and play it back locally, so the test covers
      // recording and not merely permission.
      const mimeType = pickRecorderMimeType((candidate) =>
        MediaRecorder.isTypeSupported(candidate),
      );
      if (mimeType) {
        const recorder = new MediaRecorder(stream, { mimeType });
        const chunks: BlobPart[] = [];
        recorder.ondataavailable = (event) => chunks.push(event.data);
        recorder.onstop = () => {
          const blob = new Blob(chunks, { type: mimeType });
          setFindings((current) => ({
            ...current,
            clipBytes: blob.size,
            clipType: blob.type || mimeType,
          }));
          setPlaybackUrl(URL.createObjectURL(blob));
        };
        recorder.start();
        setTimeout(() => {
          if (recorder.state !== "inactive") recorder.stop();
        }, CLIP_MS);
      }
    } catch (error) {
      const name = error instanceof Error ? error.name : "";
      setFindings((current) => ({
        ...current,
        error:
          name === "NotAllowedError"
            ? "Permission was declined for the camera or microphone."
            : name === "NotFoundError"
              ? "No camera or microphone was found."
              : `Capture failed (${name || "unknown error"}).`,
      }));
      setRunning(false);
    }
  }, [cameraId, microphoneId, refreshDevices]);

  useEffect(() => {
    if (!navigator?.mediaDevices) return;
    const onChange = () => void refreshDevices();
    navigator.mediaDevices.addEventListener("devicechange", onChange);
    // The first read is deferred so the effect body itself does not set state;
    // the subscription is what keeps the list current afterwards.
    const initial = setTimeout(onChange, 0);
    return () => {
      clearTimeout(initial);
      navigator.mediaDevices.removeEventListener("devicechange", onChange);
    };
  }, [refreshDevices]);

  useEffect(() => stop, [stop]);

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
