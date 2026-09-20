"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { ContractValidationError, parseTranscriptionResult } from "../../shared/contracts";
import { buildTranscriptionRequest, pickRecorderMimeType, type TranscriptionResult } from "./audio";

/** Long enough for a sentence, short enough to stay useful while it is spoken. */
const CLIP_MS = 10_000;

export type AudioState =
  | { state: "off" }
  | { state: "requesting-microphone" }
  | { state: "unsupported"; reason: string }
  | { state: "recording"; lastResult: TranscriptionResult | null; lastError: string | null };

interface AudioSession {
  stream: MediaStream | null;
  recorder: MediaRecorder | null;
  timer: ReturnType<typeof setTimeout> | null;
  request: AbortController | null;
  monitor?: ReturnType<typeof setInterval>;
  context?: AudioContext;
}

function detachRecorder(recorder: MediaRecorder) {
  recorder.ondataavailable = null;
  recorder.onstop = null;
  recorder.onerror = null;
}

function releaseSession(session: AudioSession) {
  if (session.timer !== null) clearTimeout(session.timer);
  session.request?.abort();
  if (session.monitor) clearInterval(session.monitor);
  void session.context?.close().catch(() => undefined);
  if (session.recorder) {
    // stop() queues a final data event. Detach it before stopping so a user
    // cancelling capture never sends another clip or restarts the recorder.
    detachRecorder(session.recorder);
    try {
      if (session.recorder.state !== "inactive") session.recorder.stop();
    } catch {
      // Tracks must still be released if the recorder has already failed.
    }
  }
  session.stream?.getTracks().forEach((track) => {
    track.onended = null;
    track.stop();
  });
}

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("could not read clip"));
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.readAsDataURL(blob);
  });
}

/** Records complete, independently decodable clips, with at most one upload. */
export function useAudioTranscription(
  sourceId: string,
  onResult?: (result: TranscriptionResult) => void,
  options?: { onSpike?: () => void; urgent?: boolean },
) {
  const [state, setState] = useState<AudioState>({ state: "off" });
  // Consumers may publish this track, but this hook remains its sole owner.
  // Sharing must never open a second microphone or stop the transcription track.
  const [microphoneStream, setMicrophoneStream] = useState<MediaStream | null>(null);
  const sessionRef = useRef<AudioSession | null>(null);
  const sourceIdRef = useRef(sourceId);
  const onResultRef = useRef(onResult);
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  useEffect(() => {
    sourceIdRef.current = sourceId;
  }, [sourceId]);

  useEffect(() => {
    onResultRef.current = onResult;
  }, [onResult]);

  const stop = useCallback(() => {
    const session = sessionRef.current;
    sessionRef.current = null;
    setMicrophoneStream(null);
    if (session) releaseSession(session);
    setState({ state: "off" });
  }, []);

  const send = useCallback(
    async (
      session: AudioSession,
      blob: Blob,
      mimeType: string,
      capturedAt: Date,
      clipSourceId: string,
    ) => {
      // Prefer the next fresh clip to queuing audio while the service is busy.
      if (sessionRef.current !== session || session.request || blob.size === 0) return;
      const request = new AbortController();
      session.request = request;
      const reportError = (lastError: string) => {
        setState((current) =>
          sessionRef.current === session && current.state === "recording"
            ? { ...current, lastError }
            : current,
        );
      };
      try {
        const dataUrl = await readAsDataUrl(blob);
        if (sessionRef.current !== session) return;
        const body = buildTranscriptionRequest({
          dataUrl,
          recorderMimeType: mimeType,
          sourceId: clipSourceId,
          capturedAt,
        });
        if (!body) {
          reportError("This browser recorded a clip the service rejects.");
          return;
        }

        const response = await fetch("/api/transcribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: request.signal,
          cache: "no-store",
        });
        if (sessionRef.current !== session) return;
        if (!response.ok) {
          reportError(`Transcription returned ${response.status}.`);
          return;
        }

        const result = parseTranscriptionResult(await response.json());
        const current = sessionRef.current === session;
        setState((previous) =>
          current && previous.state === "recording"
            ? {
                state: "recording",
                lastResult: result,
                lastError:
                  response.headers.get("X-Incident-Publication") === "failed"
                    ? "Transcript received, but sharing to the incident log failed."
                    : null,
              }
            : previous,
        );
        // Only for the live session: a clip that finished after stop was
        // pressed must not publish anything.
        if (current) {
          try {
            onResultRef.current?.(result);
          } catch {
            // Reported by the subscriber, not here.
          }
        }
      } catch (error) {
        reportError(
          error instanceof ContractValidationError
            ? "Invalid transcription response. Speech hypotheses are unavailable."
            : "Could not reach the transcription route.",
        );
      } finally {
        if (session.request === request) session.request = null;
      }
    },
    [],
  );

  const start = useCallback(
    async (microphoneId: string | null = null) => {
      if (sessionRef.current) return;

      if (
        typeof MediaRecorder === "undefined" ||
        typeof navigator === "undefined" ||
        !navigator.mediaDevices?.getUserMedia
      ) {
        setState({
          state: "unsupported",
          reason: "This browser cannot record audio. A secure context is required.",
        });
        return;
      }

      const supportedMimeType = pickRecorderMimeType((candidate) =>
        MediaRecorder.isTypeSupported(candidate),
      );
      if (!supportedMimeType) {
        setState({
          state: "unsupported",
          reason: "This browser records no audio format the service accepts.",
        });
        return;
      }
      const mimeType: string = supportedMimeType;

      // Reserve the session before awaiting permission. Stop and unmount also
      // invalidate pending permission grants and any callbacks from old sessions.
      const session: AudioSession = { stream: null, recorder: null, timer: null, request: null };
      sessionRef.current = session;
      setState({ state: "requesting-microphone" });
      const fail = (reason: string) => {
        if (sessionRef.current !== session) return;
        sessionRef.current = null;
        setMicrophoneStream(null);
        releaseSession(session);
        setState({ state: "unsupported", reason });
      };

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: microphoneId ? { deviceId: { exact: microphoneId } } : true,
          video: false,
        });
        if (sessionRef.current !== session) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        session.stream = stream;
        // Local amplitude detection is a trigger for closer review, never a gunshot classifier.
        try {
          const context = new AudioContext();
          session.context = context;
          await context.resume();
          if (sessionRef.current !== session) {
            releaseSession(session);
            return;
          }
          const analyser = context.createAnalyser();
          analyser.fftSize = 1024;
          context.createMediaStreamSource(stream).connect(analyser);
          const samples = new Float32Array(analyser.fftSize);
          let baseline = 0.02;
          let lastSpike = 0;
          let count = 0;
          session.monitor = setInterval(() => {
            if (sessionRef.current !== session) return;
            analyser.getFloatTimeDomainData(samples);
            const rms = Math.sqrt(
              samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length,
            );
            count += 1;
            if (count > 8 && rms > 0.12 && rms > baseline * 3 && Date.now() - lastSpike > 15_000) {
              lastSpike = Date.now();
              optionsRef.current?.onSpike?.();
            }
            baseline = baseline * 0.95 + rms * 0.05;
          }, 100);
        } catch {
          // Transcription remains available if Web Audio cannot start.
          void session.context?.close().catch(() => undefined);
          session.context = undefined;
        }
        stream.getTracks().forEach((track) => {
          track.onended = () => fail("Microphone capture ended. Start listening to try again.");
        });

        function recordClip() {
          if (sessionRef.current !== session) return;
          const recorder = new MediaRecorder(stream, { mimeType });
          session.recorder = recorder;
          const capturedAt = new Date();
          const clipSourceId = sourceIdRef.current;
          const chunks: Blob[] = [];
          let clipComplete = false;
          recorder.ondataavailable = (event) => {
            if (sessionRef.current === session && event.data.size > 0) chunks.push(event.data);
          };
          recorder.onerror = () => fail("Audio recording failed. Start listening to try again.");
          recorder.onstop = () => {
            if (sessionRef.current !== session) return;
            detachRecorder(recorder);
            session.recorder = null;
            if (session.timer !== null) clearTimeout(session.timer);
            session.timer = null;
            if (!clipComplete) {
              fail("Microphone capture ended. Start listening to try again.");
              return;
            }
            const recordedMimeType = recorder.mimeType || mimeType;
            const blob = new Blob(chunks, { type: recordedMimeType });
            try {
              recordClip();
            } catch {
              fail("Audio recording failed. Start listening to try again.");
              return;
            }
            void send(session, blob, recordedMimeType, capturedAt, clipSourceId);
          };
          // Timeslice blobs belong to one container and need not be playable on
          // their own. Finalize a complete recording before starting the next.
          recorder.start();
          session.timer = setTimeout(
            () => {
              if (sessionRef.current !== session) return;
              clipComplete = true;
              try {
                recorder.stop();
              } catch {
                fail("Audio recording failed. Start listening to try again.");
              }
            },
            optionsRef.current?.urgent ? 3_000 : CLIP_MS,
          );
        }

        recordClip();
        setMicrophoneStream(stream);
        setState({ state: "recording", lastResult: null, lastError: null });
      } catch {
        fail("Microphone permission was declined, or no microphone is available.");
      }
    },
    [send],
  );

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.hidden && sessionRef.current) stop();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      stop();
    };
  }, [stop]);

  return { state, start, stop, stream: microphoneStream };
}
