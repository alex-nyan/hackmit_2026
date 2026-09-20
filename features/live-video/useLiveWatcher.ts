"use client";

import { useEffect, useState } from "react";

import {
  CONNECT_TIMEOUT_MS,
  HANDSHAKE_POLL_MS,
  RETRY_MS,
  closePeer,
  fetchSignals,
  gathered,
  isDead,
  loadIceConfig,
  sendBye,
  sendSignal,
  sleep,
} from "./peer";
import { newPeerId, type SignalMessage } from "./signal";

/**
 * Asks one officer's camera for a direct link, and keeps asking.
 *
 * Reported honestly rather than optimistically, because the caller's job is
 * to decide what to show: `live` is a real video track arriving, and anything
 * else means the frame tile is still the truthful picture. A source can be
 * publishing frames perfectly well while this never connects — an officer on
 * a network that blocks peer traffic, or a camera already serving its limit
 * of watchers — and that is a working wall, not a broken one.
 */
export type WatchState = "idle" | "connecting" | "live" | "unavailable";

export function useLiveWatcher(sourceId: string, enabled = true) {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [state, setState] = useState<WatchState>("idle");

  const watching = enabled && sourceId !== "";

  useEffect(() => {
    if (!watching) return;

    let cancelled = false;
    let pc: RTCPeerConnection | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let watchdog: ReturnType<typeof setTimeout> | null = null;
    let cursor = "";
    let publisher = "";
    const me = newPeerId();

    function teardown() {
      if (watchdog) {
        clearTimeout(watchdog);
        watchdog = null;
      }
      closePeer(pc);
      pc = null;
      if (!cancelled) setStream(null);
    }

    function retry() {
      teardown();
      if (cancelled) return;
      setState("unavailable");
      // Spaced out rather than immediate: a source with no video publisher
      // behind it would otherwise be asked as fast as the network answers.
      timer = setTimeout(() => void attempt(), RETRY_MS);
    }

    async function waitForAnswer(deadline: number): Promise<SignalMessage | null> {
      while (!cancelled && Date.now() < deadline) {
        const page = await fetchSignals(sourceId, cursor, me);
        if (cancelled) return null;
        if (page) {
          cursor = page.cursor;
          const answer = page.messages.find(
            (message) => message.kind === "answer" && message.to === me && message.sdp,
          );
          if (answer) return answer;
        }
        await sleep(HANDSHAKE_POLL_MS);
      }
      return null;
    }

    async function attempt() {
      if (cancelled) return;
      setState((current) => (current === "live" ? current : "connecting"));

      const { iceServers } = await loadIceConfig();
      if (cancelled) return;

      const connection = new RTCPeerConnection({ iceServers });
      pc = connection;

      connection.ontrack = (event) => {
        if (cancelled || pc !== connection) return;
        // Keep a small cushion for Wi-Fi jitter without accumulating a long
        // playback delay. This is a hint; the browser retains its safety floor.
        if ("jitterBufferTarget" in event.receiver) {
          try {
            event.receiver.jitterBufferTarget = 50;
          } catch {
            // Older browsers may expose the property without allowing writes.
          }
        }
        const media = event.streams[0] ?? new MediaStream([event.track]);

        const show = () => {
          if (cancelled || pc !== connection) return;
          setStream(media);
          setState("live");
        };

        /**
         * A remote track mutes when media stops arriving, which happens some
         * seconds before the connection itself admits anything is wrong. It
         * is the earliest honest answer to "is this still a live picture?",
         * and the tile goes back to the published still on it.
         *
         * The connection is deliberately not torn down: a mute is as often a
         * hiccup as a death, and `unmute` brings the picture straight back
         * without paying for another handshake. What must not survive a mute
         * is the claim that the frozen frame on screen is live.
         */
        const hide = () => {
          if (cancelled || pc !== connection) return;
          setStream(null);
          setState("connecting");
        };

        event.track.onunmute = show;
        event.track.onmute = hide;
        event.track.onended = hide;
        // Tracks usually arrive muted and unmute when the first frame lands,
        // but not always, so both routes into `show` are wired.
        if (!event.track.muted) show();
      };

      connection.onconnectionstatechange = () => {
        if (cancelled || pc !== connection) return;
        // Connected means the two agreed on a route, not that a picture is
        // arriving. Only a track says that, so only a track declares `live`.
        if (connection.connectionState === "connected") {
          if (watchdog) {
            clearTimeout(watchdog);
            watchdog = null;
          }
          return;
        }
        if (isDead(connection.connectionState)) retry();
      };

      try {
        // Receive only. A dashboard watching a scene has no camera to offer
        // back, and saying so keeps the officer's browser from asking.
        connection.addTransceiver("video", { direction: "recvonly" });
        await connection.setLocalDescription(await connection.createOffer());
        // Candidates travel inside the description, so the offer is not worth
        // sending until gathering has had its moment.
        await gathered(connection);
        if (cancelled || pc !== connection) return;

        const sdp = connection.localDescription?.sdp;
        if (!sdp) {
          retry();
          return;
        }

        // Read from where the mailbox is now. An answer already sitting there
        // was addressed to a previous attempt, under a name this one dropped.
        const opening = await fetchSignals(sourceId, "", me);
        if (cancelled || pc !== connection) return;
        cursor = opening?.cursor ?? "";

        if (!(await sendSignal(sourceId, { kind: "offer", from: me, to: "", sdp }))) {
          retry();
          return;
        }
        if (cancelled || pc !== connection) return;

        const answer = await waitForAnswer(Date.now() + CONNECT_TIMEOUT_MS);
        if (cancelled || pc !== connection) return;
        if (!answer?.sdp) {
          // Nobody is offering video on this source. Common and not an error:
          // the officer's page may predate this, or be serving its limit.
          retry();
          return;
        }

        publisher = answer.from;
        await connection.setRemoteDescription({ type: "answer", sdp: answer.sdp });
        if (cancelled || pc !== connection) return;

        // Described, but not yet connected. On a network that isolates its
        // clients from each other this is exactly where it stops, silently,
        // so it is given a deadline rather than left hanging.
        watchdog = setTimeout(() => {
          if (!cancelled && pc === connection && connection.connectionState !== "connected") {
            retry();
          }
        }, CONNECT_TIMEOUT_MS);
      } catch {
        retry();
      }
    }

    void attempt();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      if (watchdog) clearTimeout(watchdog);
      if (publisher) sendBye(sourceId, me, publisher);
      closePeer(pc);
      pc = null;
    };
  }, [watching, sourceId]);

  // Derived rather than cleared from the effect: a hook that is not watching
  // has no stream and nothing to report, which is a fact about its arguments
  // rather than a state to be driven into.
  return watching ? { stream, state } : { stream: null, state: "idle" as const };
}
