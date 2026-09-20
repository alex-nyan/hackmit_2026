"use client";

import { useEffect, useRef, useState } from "react";
import type VDONinja from "@vdoninja/sdk/browser";
import { useAudioTranscription } from "../camera-triage/useAudioTranscription";
import { describeTranscript } from "../camera-triage/audio";
import styles from "./BroadcastDock.module.css";

/** Receive the same remote stream's audio; never reopen the Mac microphone. */
export function BroadcastAudioAnalysis({ viewUrl, relay }: { viewUrl: string; relay: boolean }) {
  const [source, setSource] = useState("officer-P-01");
  const [enabled, setEnabled] = useState(false);
  const [connection, setConnection] = useState("Audio analysis is off.");
  const [receivedBytes, setReceivedBytes] = useState(0);
  const [inputLevel, setInputLevel] = useState(0);
  const [audioHealth, setAudioHealth] = useState("");
  const audioContext = useRef<AudioContext | null>(null);
  const decoderPlayer = useRef<HTMLAudioElement | null>(null);
  const [configuration, setConfiguration] = useState<{ provider: string; cloud: boolean } | null>(
    null,
  );
  const audio = useAudioTranscription(source);
  const { start, stop } = audio;

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/audio-assess", { signal: controller.signal, cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then(setConfiguration)
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let sdk: VDONinja | undefined;
    let receivedTrack: MediaStreamTrack | undefined;
    let decodedInput: MediaStreamAudioSourceNode | undefined;
    let decodedOutput: MediaStreamAudioDestinationNode | undefined;
    let analyser: AnalyserNode | undefined;
    const player = decoderPlayer.current;
    const meter = setInterval(() => {
      if (receivedTrack)
        setAudioHealth(
          `${receivedTrack.readyState}, ${receivedTrack.muted ? "muted" : "unmuted"}, ${receivedTrack.enabled ? "enabled" : "disabled"}; decoder ${audioContext.current?.state ?? "off"}`,
        );
      if (analyser) {
        const samples = new Float32Array(analyser.fftSize);
        analyser.getFloatTimeDomainData(samples);
        setInputLevel(
          Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length),
        );
      }
      if (!sdk || disposed) return;
      void sdk
        .getStats()
        .then((peers) => {
          if (disposed) return;
          const bytes = Object.values(peers)
            .flat()
            .reduce(
              (total, report) =>
                report.type === "inbound-rtp" &&
                (report.kind === "audio" || report.mediaType === "audio") &&
                typeof report.bytesReceived === "number"
                  ? total + report.bytesReceived
                  : total,
              0,
            );
          setReceivedBytes(bytes);
        })
        .catch(() => undefined);
    }, 2000);
    const pause = () => {
      if (!document.hidden) return;
      setEnabled(false);
      setConnection(
        "Analysis stopped because the receiving tab was hidden. Restart with this tab visible.",
      );
    };
    document.addEventListener("visibilitychange", pause);
    const timeout = setTimeout(() => {
      if (!receivedTrack && !disposed) {
        setConnection(
          "No broadcast audio received. Confirm the phone is broadcasting with its microphone enabled, then retry or use relay.",
        );
        setEnabled(false);
      }
    }, 30_000);
    const interrupted = () => {
      if (disposed) return;
      stop();
      setEnabled(false);
      setConnection("Broadcast audio interrupted. No AI coverage; reconnect and restart analysis.");
    };
    async function receive() {
      try {
        const { default: Ninja } = await import("@vdoninja/sdk/browser");
        if (disposed) return;
        const url = new URL(viewUrl);
        let password: string | false | undefined =
          url.searchParams.get("password") ?? url.searchParams.get("pw") ?? undefined;
        if (password === "false") password = false;
        // VDO.Ninja URL passwords receive an additional decode on the publisher.
        else if (password) {
          try {
            password = decodeURIComponent(password);
          } catch {
            /* Use literal password. */
          }
        }
        sdk = new Ninja({ password, salt: "vdo.ninja", forceTURN: relay, debug: false });
        sdk.on("track", ({ detail }) => {
          if (disposed || detail.track.kind !== "audio" || detail.track === receivedTrack) return;
          stop();
          receivedTrack = detail.track;
          clearTimeout(timeout);
          receivedTrack.addEventListener("ended", interrupted);
          setConnection("Receiving broadcast audio → speech recognition → dispatch review.");
          // Decode the remote track into a local PCM stream before recording.
          // Recording the remote track directly produces empty clips in some browsers.
          const context = audioContext.current;
          if (!context || context.state !== "running" || !player) {
            interrupted();
            return;
          }
          decodedInput?.disconnect();
          decodedOutput?.stream.getTracks().forEach((track) => track.stop());
          decodedOutput = context.createMediaStreamDestination();
          const media = new MediaStream([receivedTrack]);
          // Attach a playback sink as well: Chromium may not pull decoded remote
          // audio into Web Audio until an HTML media element consumes the track.
          player.srcObject = media;
          player.volume = 0;
          void player.play().catch(interrupted);
          decodedInput = context.createMediaStreamSource(media);
          analyser = context.createAnalyser();
          decodedInput.connect(analyser);
          decodedInput.connect(decodedOutput);
          void start(null, decodedOutput.stream);
        });
        sdk.on("connectionFailed", interrupted);
        sdk.on("peerDisconnected", interrupted);
        sdk.on("disconnected", interrupted);
        sdk.on("error", interrupted);
        await sdk.connect();
        if (disposed) {
          await sdk.disconnect();
          return;
        }
        const room = url.searchParams.get("room");
        if (room) await sdk.joinRoom({ room, ...(password !== undefined ? { password } : {}) });
        if (disposed) {
          await sdk.disconnect();
          return;
        }
        await sdk.view(url.searchParams.get("view")!, {
          audio: true,
          video: false,
          downloads: false,
        });
      } catch {
        if (!disposed) interrupted();
      }
    }
    void receive();
    return () => {
      disposed = true;
      clearTimeout(timeout);
      clearInterval(meter);
      document.removeEventListener("visibilitychange", pause);
      receivedTrack?.removeEventListener("ended", interrupted);
      stop();
      decodedInput?.disconnect();
      decodedOutput?.stream.getTracks().forEach((track) => track.stop());
      if (player) {
        player.pause();
        player.srcObject = null;
      }
      void audioContext.current?.close().catch(() => undefined);
      audioContext.current = null;
      void sdk?.disconnect().catch(() => undefined);
    };
  }, [enabled, relay, start, stop, viewUrl]);

  return (
    <section aria-label="Broadcast audio analysis" className={styles.analysis}>
      <audio ref={decoderPlayer} autoPlay aria-hidden="true" style={{ display: "none" }} />
      <h3>Audio → dispatch AI</h3>
      <p className={styles.note}>
        Analyze the sound from this broadcast. Assign its reporting officer before starting.
      </p>
      <label>
        Reporting source{" "}
        <input
          aria-label="Broadcast reporting source"
          value={source}
          maxLength={128}
          disabled={enabled}
          onChange={(event) => setSource(event.target.value)}
        />
      </label>
      {configuration?.cloud && (
        <p className={styles.note}>
          Transcripts will be sent to {configuration.provider} for contextual analysis.
        </p>
      )}
      <button
        type="button"
        disabled={!enabled && !/^[A-Za-z0-9_.:-]{1,128}$/.test(source)}
        onClick={async () => {
          if (enabled) {
            setEnabled(false);
            setConnection("Audio analysis is off.");
          } else {
            try {
              const context = new AudioContext();
              audioContext.current = context;
              await context.resume();
            } catch {
              setConnection(
                "Audio playback permission is required to decode the broadcast. Retry after allowing playback.",
              );
              return;
            }
            setReceivedBytes(0);
            setInputLevel(0);
            setConnection("Connecting to the broadcast microphone…");
            setEnabled(true);
          }
        }}
      >
        {enabled ? "Stop broadcast analysis" : "Analyze broadcast audio"}
      </button>
      <p role="status" className={styles.note}>
        {connection}
      </p>
      {enabled && (
        <small>
          {receivedBytes > 0
            ? `Audio data received: ${Math.round(receivedBytes / 1024)} KB · Input level: ${Math.min(100, Math.round(inputLevel * 100))}%`
            : "Waiting for audio data; a connected player alone does not confirm AI coverage."}
        </small>
      )}
      {enabled && (
        <details>
          <summary>Audio connection details</summary>
          <small>{audioHealth}</small>
        </details>
      )}
      {audio.state.state === "unsupported" && (
        <p role="alert" className={styles.error}>
          {audio.state.reason}
        </p>
      )}
      {audio.state.state === "recording" && (
        <div aria-live="polite">
          <p>
            {audio.state.lastResult
              ? describeTranscript(audio.state.lastResult)
              : "Receiving 5-second clips; waiting for first transcript…"}
          </p>
          <p>{audio.state.analysisMessage}</p>
          <small>
            {audio.state.queuedClips ?? 0} clips queued · Keep this dashboard tab visible.
          </small>
          {audio.state.lastError && (
            <p role="alert" className={styles.error}>
              {audio.state.lastError}
            </p>
          )}
          {audio.state.coverageGap && (
            <p role="alert" className={styles.error}>
              {audio.state.coverageGap}
            </p>
          )}
        </div>
      )}
      <p className={styles.note}>
        Alerts appear in the main dispatch Audio intelligence panel. Phrase alerts stay pending
        until reviewed. No automatic emergency dispatch.
      </p>
    </section>
  );
}
