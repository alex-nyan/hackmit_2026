"use client";

import { useEffect, useState } from "react";

import { monitorPeer, reportPeerIssue } from "./diagnostics";
import { createIceExchange } from "./iceExchange";
import {
  CONNECTED_POLL_MS,
  CONNECT_TIMEOUT_MS,
  DISCONNECT_GRACE_MS,
  HANDSHAKE_POLL_MS,
  MEDIA_STALL_MS,
  RETRY_MS,
  closePeer,
  connectionFailureReason,
  createSignalDeduplicator,
  fetchSignals,
  isDead,
  loadIceConfig,
  primeLocalCandidates,
  sendBye,
  sendSignal,
} from "./peer";
import { newPeerId, type SignalMessage } from "./signal";

export type WatchState = "idle" | "connecting" | "live" | "stalled" | "unavailable";

interface WatchAttempt {
  id: string;
  publisher: string;
  pc: RTCPeerConnection | null;
  abort: AbortController;
  exchange?: ReturnType<typeof createIceExchange>;
  pollTimer?: ReturnType<typeof setTimeout>;
  setupTimer?: ReturnType<typeof setTimeout>;
  disconnectTimer?: ReturnType<typeof setTimeout>;
  mediaTimer?: ReturnType<typeof setTimeout>;
  stopDiagnostics?: () => void;
  trackCleanup: (() => void)[];
}

/** Each attempt owns its IDs, requests, candidate queues, and deadlines. */
export function useLiveWatcher(sourceId: string, enabled = true) {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [state, setState] = useState<WatchState>("idle");
  const watching = enabled && sourceId !== "";

  useEffect(() => {
    if (!watching) return;
    let cancelled = false;
    let active: WatchAttempt | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    function isCurrent(attempt: WatchAttempt) {
      return !cancelled && active === attempt && !attempt.abort.signal.aborted;
    }

    function teardown(attempt: WatchAttempt) {
      attempt.abort.abort();
      if (attempt.pollTimer) clearTimeout(attempt.pollTimer);
      if (attempt.setupTimer) clearTimeout(attempt.setupTimer);
      if (attempt.disconnectTimer) clearTimeout(attempt.disconnectTimer);
      if (attempt.mediaTimer) clearTimeout(attempt.mediaTimer);
      attempt.stopDiagnostics?.();
      attempt.exchange?.dispose();
      attempt.trackCleanup.forEach((cleanup) => cleanup());
      // An unaddressed bye also releases a publisher still preparing its answer.
      sendBye(sourceId, attempt.id, attempt.publisher);
      closePeer(attempt.pc);
    }

    function retry(attempt: WatchAttempt) {
      if (!isCurrent(attempt)) return;
      active = null;
      teardown(attempt);
      setStream(null);
      setState("unavailable");
      if (!retryTimer) {
        retryTimer = setTimeout(() => {
          retryTimer = null;
          void connect();
        }, RETRY_MS);
      }
    }

    async function connect() {
      if (cancelled || active) return;
      const attempt: WatchAttempt = {
        id: newPeerId(),
        publisher: "",
        pc: null,
        abort: new AbortController(),
        trackCleanup: [],
      };
      active = attempt;
      let hasRelay: boolean | undefined;
      setStream(null);
      setState("connecting");
      attempt.setupTimer = setTimeout(() => {
        reportPeerIssue(
          attempt.id,
          `No first video arrived before the connection deadline.${attempt.publisher && hasRelay === false ? ` ${connectionFailureReason(false)}` : ""}`,
          "watcher",
        );
        retry(attempt);
      }, CONNECT_TIMEOUT_MS);
      try {
        const { iceServers, relay } = await loadIceConfig(attempt.abort.signal);
        if (!isCurrent(attempt)) return;
        hasRelay = relay;
        const pc = new RTCPeerConnection({ iceServers });
        attempt.pc = pc;
        const media = new MediaStream();
        let cursor = "";
        const unseen = createSignalDeduplicator();
        const pendingCandidates: SignalMessage[] = [];
        let lastFrames: number | undefined;
        let lastProgress = performance.now();
        let showing = false;
        const startedAt = performance.now();

        function show() {
          if (
            !isCurrent(attempt) ||
            !media.getVideoTracks().some((track) => track.readyState === "live")
          )
            return;
          if (attempt.setupTimer) clearTimeout(attempt.setupTimer);
          if (attempt.mediaTimer) clearTimeout(attempt.mediaTimer);
          attempt.mediaTimer = undefined;
          if (!showing) {
            showing = true;
            setStream(media);
            setState("live");
          }
        }

        function stalled() {
          if (!isCurrent(attempt)) return;
          showing = false;
          setStream(null);
          setState("stalled");
          // Track mute is still useful on browsers without frame counters.
          if (!attempt.mediaTimer) {
            attempt.mediaTimer = setTimeout(() => retry(attempt), MEDIA_STALL_MS);
          }
        }

        attempt.stopDiagnostics = monitorPeer(pc, {
          sourceId,
          peerId: attempt.id,
          role: "watcher",
          onSample(sample) {
            if (!isCurrent(attempt) || sample.framesDecoded === undefined) return;
            if (lastFrames === undefined || sample.framesDecoded !== lastFrames) {
              const advancing = sample.framesDecoded > (lastFrames ?? 0);
              lastFrames = sample.framesDecoded;
              if (advancing) {
                lastProgress = sample.timestamp;
                show();
              }
            }
            if (pc.connectionState !== "connected" && pc.connectionState !== "disconnected") return;
            const stalledFor = sample.timestamp - lastProgress;
            if (stalledFor > MEDIA_STALL_MS) {
              reportPeerIssue(
                attempt.id,
                "Incoming video stopped decoding; reconnecting.",
                "watcher",
              );
              retry(attempt);
            } else if (showing && stalledFor > MEDIA_STALL_MS / 2) stalled();
          },
        });
        attempt.exchange = createIceExchange(pc, {
          sourceId,
          from: attempt.id,
          to: () => attempt.publisher,
          signal: attempt.abort.signal,
          onIssue: (message) => reportPeerIssue(attempt.id, message, "watcher"),
          onFailure: () => {
            if (isCurrent(attempt) && pc.connectionState !== "connected") retry(attempt);
          },
        });

        pc.ontrack = (event) => {
          if (!isCurrent(attempt)) return;
          if (!media.getTracks().some((track) => track.id === event.track.id))
            media.addTrack(event.track);
          if (event.track.kind !== "video") return;
          if ("jitterBufferTarget" in event.receiver) {
            try {
              event.receiver.jitterBufferTarget = 50;
            } catch (error) {
              reportPeerIssue(
                attempt.id,
                `Receiver buffer hint unavailable: ${String(error)}`,
                "watcher",
              );
            }
          }
          const unmute = () => {
            lastProgress = performance.now();
            show();
          };
          const ended = () => retry(attempt);
          event.track.addEventListener("unmute", unmute);
          event.track.addEventListener("mute", stalled);
          event.track.addEventListener("ended", ended);
          attempt.trackCleanup.push(() => {
            event.track.removeEventListener("unmute", unmute);
            event.track.removeEventListener("mute", stalled);
            event.track.removeEventListener("ended", ended);
          });
          if (!event.track.muted) unmute();
        };

        pc.onconnectionstatechange = () => {
          if (!isCurrent(attempt)) return;
          if (pc.connectionState === "connected") {
            lastProgress = performance.now();
            if (attempt.disconnectTimer) clearTimeout(attempt.disconnectTimer);
            attempt.disconnectTimer = undefined;
          } else if (pc.connectionState === "disconnected" && !attempt.disconnectTimer) {
            attempt.disconnectTimer = setTimeout(() => {
              if (isCurrent(attempt) && pc.connectionState === "disconnected") retry(attempt);
            }, DISCONNECT_GRACE_MS);
          } else if (isDead(pc.connectionState)) {
            if (pc.connectionState === "failed") {
              reportPeerIssue(attempt.id, connectionFailureReason(relay), "watcher");
            }
            retry(attempt);
          }
        };

        async function poll() {
          if (!isCurrent(attempt)) return;
          const page = await fetchSignals(sourceId, cursor, attempt.id, attempt.abort.signal);
          if (!isCurrent(attempt)) return;
          if (page) {
            cursor = page.cursor;
            for (const message of page.messages) {
              if (message.to !== attempt.id || !unseen(message)) continue;
              if (message.kind === "answer" && !attempt.publisher && message.sdp) {
                attempt.publisher = message.from;
                try {
                  await pc.setRemoteDescription({ type: "answer", sdp: message.sdp });
                  if (!isCurrent(attempt)) return;
                  await attempt.exchange?.remoteDescriptionReady();
                  for (const pending of pendingCandidates) {
                    if (pending.from === attempt.publisher)
                      await attempt.exchange?.receive(pending);
                  }
                  pendingCandidates.length = 0;
                  attempt.exchange?.start();
                } catch (error) {
                  reportPeerIssue(attempt.id, `Answer rejected: ${String(error)}`, "watcher");
                  retry(attempt);
                  return;
                }
              } else if (message.kind === "candidates") {
                if (message.from === attempt.publisher) await attempt.exchange?.receive(message);
                else if (!attempt.publisher && pendingCandidates.length < 16)
                  pendingCandidates.push(message);
              } else if (message.kind === "bye" && message.from === attempt.publisher) {
                retry(attempt);
                return;
              }
              if (!isCurrent(attempt)) return;
            }
          }
          const connected =
            pc.connectionState === "connected" &&
            (attempt.exchange?.complete || performance.now() - startedAt > CONNECT_TIMEOUT_MS);
          if (isCurrent(attempt)) {
            attempt.pollTimer = setTimeout(
              () => void poll(),
              connected ? CONNECTED_POLL_MS : HANDSHAKE_POLL_MS,
            );
          }
        }

        pc.addTransceiver("video", { direction: "recvonly" });
        pc.addTransceiver("audio", { direction: "recvonly" });
        await pc.setLocalDescription(await pc.createOffer());
        if (!isCurrent(attempt)) return;
        await primeLocalCandidates(pc, attempt.abort.signal);
        if (!isCurrent(attempt)) return;
        const sdp = pc.localDescription?.sdp;
        if (
          !sdp ||
          !(await sendSignal(
            sourceId,
            { kind: "offer", from: attempt.id, to: "", sdp },
            attempt.abort.signal,
          ))
        ) {
          reportPeerIssue(
            attempt.id,
            "Could not deliver the offer through the signaling service.",
            "watcher",
          );
          retry(attempt);
          return;
        }
        if (isCurrent(attempt)) void poll();
      } catch (error) {
        if (isCurrent(attempt)) {
          reportPeerIssue(attempt.id, `Viewer setup failed: ${String(error)}`, "watcher");
          retry(attempt);
        }
      }
    }

    void connect();
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (active) teardown(active);
      active = null;
    };
  }, [watching, sourceId]);

  return watching ? { stream, state } : { stream: null, state: "idle" as const };
}
