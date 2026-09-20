"use client";

import { useEffect, useState } from "react";

import { toSourceId } from "@/features/camera-triage/frame";

import {
  MAX_WATCHERS,
  OFFER_FRESH_MS,
  PUBLISHER_POLL_MS,
  capBitrate,
  closePeer,
  fetchSignals,
  gathered,
  isDead,
  loadIceConfig,
  sendBye,
  sendSignal,
} from "./peer";
import { newPeerId, type SignalMessage } from "./signal";

/**
 * Offers this camera to anyone watching the wall.
 *
 * The stream is the one the capture page already holds — the same Continuity
 * Camera track that the triage loop screenshots every couple of seconds. This
 * adds a second reader of it rather than a second camera: the frames keep
 * going to the model and to the archive, and the live picture stops being
 * made of them.
 *
 * One connection per watcher, because this is a direct link rather than a
 * broadcast. That is the trade for having no media server: the picture is as
 * fast as the network allows, and the publishing machine pays for each person
 * looking at it.
 */
export function useLivePublisher(rawSourceId: string, stream: MediaStream | null) {
  const [connected, setConnected] = useState(0);
  const sourceId = toSourceId(rawSourceId);

  useEffect(() => {
    // No camera, nothing to offer. The wall falls back to the frame tile,
    // which is what it showed before any of this existed.
    if (!stream || !sourceId) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let cursor = "";
    const me = newPeerId();
    const peers = new Map<string, RTCPeerConnection>();

    function drop(watcher: string) {
      const pc = peers.get(watcher);
      if (!pc) return;
      closePeer(pc);
      peers.delete(watcher);
      if (!cancelled) setConnected(peers.size);
    }

    async function answer(offer: SignalMessage) {
      if (!offer.sdp || !stream) return;
      // A second offer from the same name is that browser starting over, so
      // its previous connection is replaced rather than left to time out.
      drop(offer.from);
      if (peers.size >= MAX_WATCHERS) return;

      const { iceServers } = await loadIceConfig();
      if (cancelled) return;

      const pc = new RTCPeerConnection({ iceServers });
      peers.set(offer.from, pc);
      setConnected(peers.size);

      pc.onconnectionstatechange = () => {
        if (cancelled || peers.get(offer.from) !== pc) return;
        if (isDead(pc.connectionState)) drop(offer.from);
      };

      try {
        // Video only. The microphone has its own pipeline and its own
        // consent, and quietly opening a live audio link to every dashboard
        // because someone started their camera is not a thing to do.
        stream.getVideoTracks().forEach((track) => {
          track.contentHint = "motion";
          pc.addTrack(track, stream);
        });
        await pc.setRemoteDescription({ type: "offer", sdp: offer.sdp });
        await pc.setLocalDescription(await pc.createAnswer());
        // After the local description, which is when the encoding exists.
        await capBitrate(pc);
        await gathered(pc);
        if (cancelled || peers.get(offer.from) !== pc) return;

        const sdp = pc.localDescription?.sdp;
        if (
          !sdp ||
          !(await sendSignal(sourceId, { kind: "answer", from: me, to: offer.from, sdp }))
        ) {
          drop(offer.from);
        }
      } catch {
        drop(offer.from);
      }
    }

    async function poll() {
      if (cancelled) return;
      const page = await fetchSignals(sourceId, cursor, me);
      if (cancelled) return;

      if (page) {
        cursor = page.cursor;
        const now = Date.now();
        for (const message of page.messages) {
          if (message.from === me) continue;
          if (message.kind === "bye") {
            drop(message.from);
            continue;
          }
          if (message.kind !== "offer") continue;
          if (message.to !== "" && message.to !== me) continue;
          // An offer that has been sitting in the mailbox belongs to a
          // browser that has already given up and asked again.
          if (now - message.at > OFFER_FRESH_MS) continue;
          await answer(message);
          if (cancelled) return;
        }
      }

      if (!cancelled) timer = setTimeout(() => void poll(), PUBLISHER_POLL_MS);
    }

    void poll();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      // Say goodbye before closing: a watcher that is told goes back to the
      // frame tile now instead of holding a dead connection for nine seconds.
      for (const [watcher, pc] of peers) {
        sendBye(sourceId, me, watcher);
        closePeer(pc);
      }
      peers.clear();
    };
  }, [sourceId, stream]);

  // Derived rather than reset from the effect: with no camera open there
  // are no watchers by definition, and saying so here avoids a render whose
  // only job is to agree.
  return { watchers: stream ? connected : 0 };
}
