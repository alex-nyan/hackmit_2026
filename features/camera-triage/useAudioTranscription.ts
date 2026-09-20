"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { buildTranscriptionRequest, pickRecorderMimeType, type TranscriptionResult } from "./audio";

/** Long enough for a sentence, short enough to stay useful while it is spoken. */
const CLIP_MS = 10_000;

export type AudioState =
  | { state: "off" }
  | { state: "unsupported"; reason: string }
  | { state: "recording"; lastResult: TranscriptionResult | null; lastError: string | null };

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("could not read clip"));
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.readAsDataURL(blob);
  });
}

/**
 * Records fixed-length clips from an existing stream and sends each one for
 * transcription. Clips are sent one at a time: the service shares its model
 * budget with the vision pipeline, so overlapping uploads would only queue.
 */
export function useAudioTranscription(sourceId: string) {
  const [state, setState] = useState<AudioState>({ state: "off" });
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const inFlightRef = useRef(false);
  const sourceIdRef = useRef(sourceId);

  useEffect(() => {
    sourceIdRef.current = sourceId;
  }, [sourceId]);

  const stop = useCallback(() => {
    try {
      recorderRef.current?.stop();
    } catch {
      // A recorder already stopped throws; nothing to recover.
    }
    recorderRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setState({ state: "off" });
  }, []);

  const send = useCallback(async (blob: Blob, mimeType: string) => {
    // Drop a clip rather than pile requests onto a service that takes one at a
    // time; the next clip is a better use of the slot than a stale one.
    if (inFlightRef.current || blob.size === 0) return;
    inFlightRef.current = true;
    try {
      const body = buildTranscriptionRequest({
        dataUrl: await readAsDataUrl(blob),
        recorderMimeType: mimeType,
        sourceId: sourceIdRef.current,
        capturedAt: new Date(Date.now() - CLIP_MS),
      });
      if (!body) {
        setState((current) =>
          current.state === "recording"
            ? { ...current, lastError: "This browser recorded a format the service rejects." }
            : current,
        );
        return;
      }

      const response = await fetch("/api/transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        cache: "no-store",
      });

      if (!response.ok) {
        setState((current) =>
          current.state === "recording"
            ? { ...current, lastError: `Transcription returned ${response.status}.` }
            : current,
        );
        return;
      }

      const result = (await response.json()) as TranscriptionResult;
      setState((current) =>
        current.state === "recording"
          ? { state: "recording", lastResult: result, lastError: null }
          : current,
      );
    } catch {
      setState((current) =>
        current.state === "recording"
          ? { ...current, lastError: "Could not reach the transcription route." }
          : current,
      );
    } finally {
      inFlightRef.current = false;
    }
  }, []);

  const start = useCallback(async () => {
    if (recorderRef.current) return;

    if (typeof window === "undefined" || typeof MediaRecorder === "undefined") {
      setState({
        state: "unsupported",
        reason: "This browser cannot record audio. A secure context is required.",
      });
      return;
    }

    const mimeType = pickRecorderMimeType((candidate) => MediaRecorder.isTypeSupported(candidate));
    if (!mimeType) {
      setState({
        state: "unsupported",
        reason: "This browser records no audio format the service accepts.",
      });
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      streamRef.current = stream;
      const recorder = new MediaRecorder(stream, { mimeType });
      recorder.ondataavailable = (event) => void send(event.data, mimeType);
      // A timeslice emits a clip every interval without stopping the recorder.
      recorder.start(CLIP_MS);
      recorderRef.current = recorder;
      setState({ state: "recording", lastResult: null, lastError: null });
    } catch {
      setState({
        state: "unsupported",
        reason: "Microphone permission was declined, or no microphone is available.",
      });
    }
  }, [send]);

  useEffect(() => stop, [stop]);

  return { state, start, stop };
}
