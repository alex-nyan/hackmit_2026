"use client";

import { useEffect, useRef, useState } from "react";

import { toSourceId } from "@/features/camera-triage/frame";

import { monitorPeer, reportPeerIssue } from "./diagnostics";
import { createIceExchange } from "./iceExchange";
import {
  CONNECT_TIMEOUT_MS,
  DISCONNECT_GRACE_MS,
  HANDSHAKE_POLL_MS,
  MAX_BITRATE,
  MAX_WATCHERS,
  MEDIA_STALL_MS,
  OFFER_FRESH_MS,
  PUBLISHER_POLL_MS,
  PUBLISHER_VIDEO_BUDGET,
  capBitrate,
  closePeer,
  connectionFailureReason,
  createSignalDeduplicator,
  fetchSignals,
  isDead,
  loadIceConfig,
  primeLocalCandidates,
  sendBye,
  sendSignal,
  updateSender,
} from "./peer";
import { newPeerId, type SignalMessage } from "./signal";
import { usePublisherPresence } from "./usePublisherPresence";

interface PublisherPeer {
  pc: RTCPeerConnection | null;
  abort: AbortController;
  exchange?: ReturnType<typeof createIceExchange>;
  audioSender?: RTCRtpSender;
  stopDiagnostics?: () => void;
  setupTimer?: ReturnType<typeof setTimeout>;
  disconnectTimer?: ReturnType<typeof setTimeout>;
}

/** Shares the existing capture tracks; transport never owns or stops them. */
export function useLivePublisher(
  rawSourceId: string,
  stream: MediaStream | null,
  audioStream: MediaStream | null = null,
) {
  const sourceId = toSourceId(rawSourceId);
  usePublisherPresence(sourceId, stream);
  const [connected, setConnected] = useState<{ stream: MediaStream | null; count: number }>({
    stream: null,
    count: 0,
  });
  const peersRef = useRef(new Map<string, PublisherPeer>());
  const audioTrackRef = useRef<MediaStreamTrack | null>(null);

  // The audio transceiver is negotiated up front. Opting in or out later only
  // replaces that sender's track; it does not interrupt the video connection.
  useEffect(() => {
    const track = audioStream?.getAudioTracks().find((item) => item.readyState === "live") ?? null;
    function syncAudio() {
      audioTrackRef.current = track?.readyState === "live" ? track : null;
      for (const [watcher, peer] of peersRef.current) {
        const sender = peer.audioSender;
        if (!sender) continue;
        void updateSender(sender, async () => {
          if (!peer.abort.signal.aborted) await sender.replaceTrack(audioTrackRef.current);
        }).catch((error) =>
          reportPeerIssue(watcher, `Audio track update failed: ${String(error)}`, "publisher"),
        );
      }
    }
    syncAudio();
    track?.addEventListener("ended", syncAudio);
    return () => track?.removeEventListener("ended", syncAudio);
  }, [audioStream]);

  useEffect(() => {
    if (!stream || !sourceId) return;
    const cameraStream = stream;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let cursor = "";
    const abort = new AbortController();
    const me = newPeerId();
    const peers = new Map<string, PublisherPeer>();
    peersRef.current = peers;
    const unseen = createSignalDeduplicator();

    function isCurrent(watcher: string, peer: PublisherPeer) {
      return !cancelled && peers.get(watcher) === peer && !peer.abort.signal.aborted;
    }

    function reportConnected() {
      if (!cancelled) {
        setConnected({
          stream,
          count: [...peers.values()].filter((peer) => peer.pc?.connectionState === "connected")
            .length,
        });
      }
    }

    function rebalance() {
      if (cancelled) return;
      const bitrate = Math.min(
        MAX_BITRATE,
        Math.floor(PUBLISHER_VIDEO_BUDGET / Math.max(1, peers.size)),
      );
      for (const [watcher, peer] of peers) {
        if (!peer.pc?.localDescription) continue;
        void capBitrate(peer.pc, bitrate, (message) =>
          reportPeerIssue(watcher, message, "publisher"),
        );
      }
    }

    function drop(watcher: string, notify = true) {
      const peer = peers.get(watcher);
      if (!peer) return;
      peers.delete(watcher);
      if (notify) sendBye(sourceId, me, watcher);
      peer.abort.abort();
      if (peer.setupTimer) clearTimeout(peer.setupTimer);
      if (peer.disconnectTimer) clearTimeout(peer.disconnectTimer);
      peer.stopDiagnostics?.();
      peer.exchange?.dispose();
      closePeer(peer.pc);
      reportConnected();
      rebalance();
    }

    async function answer(offer: SignalMessage) {
      if (!offer.sdp || peers.has(offer.from) || peers.size >= MAX_WATCHERS || cancelled) return;
      // Reserve synchronously before the first await. Concurrent arrivals can
      // negotiate independently without all observing the same vacant slot.
      const peer: PublisherPeer = { pc: null, abort: new AbortController() };
      let hasRelay: boolean | undefined;
      peers.set(offer.from, peer);
      peer.setupTimer = setTimeout(() => {
        reportPeerIssue(
          offer.from,
          `Publisher connection setup timed out.${hasRelay === false ? ` ${connectionFailureReason(false)}` : ""}`,
          "publisher",
        );
        drop(offer.from);
      }, CONNECT_TIMEOUT_MS);
      rebalance();
      try {
        const { iceServers, relay } = await loadIceConfig(peer.abort.signal);
        if (!isCurrent(offer.from, peer)) return;
        hasRelay = relay;
        const pc = new RTCPeerConnection({ iceServers });
        peer.pc = pc;
        let lastFrames: number | undefined;
        let lastProgress = performance.now();
        peer.stopDiagnostics = monitorPeer(pc, {
          sourceId,
          peerId: offer.from,
          role: "publisher",
          onSample(sample) {
            if (!isCurrent(offer.from, peer) || sample.framesEncoded === undefined) return;
            if (lastFrames === undefined || sample.framesEncoded !== lastFrames) {
              lastFrames = sample.framesEncoded;
              lastProgress = sample.timestamp;
            } else if (
              pc.connectionState === "connected" &&
              sample.timestamp - lastProgress > MEDIA_STALL_MS
            ) {
              reportPeerIssue(
                offer.from,
                "Outgoing video stopped encoding; reconnecting.",
                "publisher",
              );
              drop(offer.from);
            }
          },
        });
        const issue = (message: string) => reportPeerIssue(offer.from, message, "publisher");
        peer.exchange = createIceExchange(pc, {
          sourceId,
          from: me,
          to: () => offer.from,
          signal: peer.abort.signal,
          onIssue: issue,
          onFailure: () => {
            if (isCurrent(offer.from, peer) && pc.connectionState !== "connected") drop(offer.from);
          },
        });
        pc.onconnectionstatechange = () => {
          if (!isCurrent(offer.from, peer)) return;
          reportConnected();
          if (pc.connectionState === "connected") {
            lastProgress = performance.now();
            if (peer.setupTimer) clearTimeout(peer.setupTimer);
            if (peer.disconnectTimer) clearTimeout(peer.disconnectTimer);
            peer.disconnectTimer = undefined;
          } else if (pc.connectionState === "disconnected" && !peer.disconnectTimer) {
            peer.disconnectTimer = setTimeout(() => {
              if (isCurrent(offer.from, peer) && pc.connectionState === "disconnected")
                drop(offer.from);
            }, DISCONNECT_GRACE_MS);
          } else if (isDead(pc.connectionState)) {
            if (pc.connectionState === "failed") issue(connectionFailureReason(relay));
            drop(offer.from);
          }
        };

        await pc.setRemoteDescription({ type: "offer", sdp: offer.sdp });
        if (!isCurrent(offer.from, peer)) return;
        await peer.exchange.remoteDescriptionReady();
        cameraStream.getVideoTracks().forEach((track) => {
          track.contentHint = "motion";
          pc.addTrack(track, cameraStream);
        });
        const audio = pc.getTransceivers().find((item) => item.receiver.track.kind === "audio");
        if (audio) {
          audio.direction = "sendonly";
          if (typeof audio.sender.setStreams === "function") {
            try {
              audio.sender.setStreams(cameraStream);
            } catch {
              issue(
                "Browser could not group audio with video; the viewer will combine the tracks.",
              );
            }
          } else {
            issue(
              "Browser cannot group sender streams; the viewer will combine audio and video tracks.",
            );
          }
          peer.audioSender = audio.sender;
          await updateSender(audio.sender, () => audio.sender.replaceTrack(audioTrackRef.current));
        }
        if (!isCurrent(offer.from, peer)) return;
        await pc.setLocalDescription(await pc.createAnswer());
        if (!isCurrent(offer.from, peer)) return;
        await Promise.all([
          capBitrate(
            pc,
            Math.min(MAX_BITRATE, Math.floor(PUBLISHER_VIDEO_BUDGET / Math.max(1, peers.size))),
            issue,
          ),
          primeLocalCandidates(pc, peer.abort.signal),
        ]);
        if (!isCurrent(offer.from, peer)) return;
        rebalance();
        const sdp = pc.localDescription?.sdp;
        if (
          !sdp ||
          !(await sendSignal(
            sourceId,
            { kind: "answer", from: me, to: offer.from, sdp },
            peer.abort.signal,
          ))
        ) {
          if (isCurrent(offer.from, peer)) {
            issue("Could not deliver the answer through the signaling service.");
            drop(offer.from);
          }
          return;
        }
        if (isCurrent(offer.from, peer)) peer.exchange.start();
      } catch (error) {
        if (isCurrent(offer.from, peer)) {
          reportPeerIssue(offer.from, `Publisher setup failed: ${String(error)}`, "publisher");
          drop(offer.from);
        }
      }
    }

    async function poll() {
      if (cancelled) return;
      const page = await fetchSignals(sourceId, cursor, me, abort.signal);
      if (cancelled) return;
      if (page) {
        cursor = page.cursor;
        for (const message of page.messages) {
          if (message.to !== "" && message.to !== me) continue;
          if (message.from === me || !unseen(message)) continue;
          if (message.kind === "bye") {
            drop(message.from, false);
          } else if (message.kind === "candidates") {
            const peer = peers.get(message.from);
            if (peer?.exchange) void peer.exchange.receive(message);
          } else if (message.kind === "offer" && Date.now() - message.at <= OFFER_FRESH_MS) {
            void answer(message);
          }
        }
      }
      const negotiating = [...peers.values()].some(
        (peer) => peer.pc?.connectionState !== "connected",
      );
      if (!cancelled)
        timer = setTimeout(() => void poll(), negotiating ? HANDSHAKE_POLL_MS : PUBLISHER_POLL_MS);
    }

    void poll();
    return () => {
      cancelled = true;
      abort.abort();
      if (timer) clearTimeout(timer);
      for (const watcher of [...peers.keys()]) drop(watcher);
      peers.clear();
    };
  }, [sourceId, stream]);

  return { watchers: stream && connected.stream === stream ? connected.count : 0 };
}
