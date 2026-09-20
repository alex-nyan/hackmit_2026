"use client";

import type { IceConfig } from "./iceServers";
import type { SignalMessage, SignalPage, SignalPost } from "./signal";

export const HANDSHAKE_POLL_MS = 300;
export const PUBLISHER_POLL_MS = 1_000;
export const CONNECTED_POLL_MS = 2_500;
export const CONNECT_TIMEOUT_MS = 15_000;
export const DISCONNECT_GRACE_MS = 5_000;
export const MEDIA_STALL_MS = 6_000;
export const RETRY_MS = 3_000;
export const OFFER_FRESH_MS = 15_000;
export const MAX_BITRATE = 2_000_000;
/** Total video payload ceiling, shared by connected and negotiating peers. */
export const PUBLISHER_VIDEO_BUDGET = 4_000_000;
export const MAX_FRAMERATE = 30;
export const MAX_WATCHERS = 4;
const REQUEST_TIMEOUT_MS = 4_500;
const INITIAL_HOST_CANDIDATE_MS = 75;

/** Include a promptly available LAN route in SDP without waiting on STUN/TURN. */
export function primeLocalCandidates(pc: RTCPeerConnection, signal: AbortSignal): Promise<void> {
  const ready = () =>
    pc.iceGatheringState === "complete" ||
    /(?:^|\n)a=candidate:[^\r\n]* typ host(?: |\r|\n|$)/.test(pc.localDescription?.sdp ?? "");
  if (signal.aborted || ready()) return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    let nextTask: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(done, INITIAL_HOST_CANDIDATE_MS);
    function done() {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (nextTask) clearTimeout(nextTask);
      pc.removeEventListener("icecandidate", onCandidate);
      pc.removeEventListener("icegatheringstatechange", onGathering);
      signal.removeEventListener("abort", done);
      resolve();
    }
    function onCandidate(event: RTCPeerConnectionIceEvent) {
      if (event.candidate && event.candidate.type !== "host") return;
      // Some implementations update localDescription at the end of the
      // candidate dispatch. Yield before the caller serializes that SDP.
      queueMicrotask(() => {
        if (settled) return;
        if (ready()) done();
        else if (!nextTask) nextTask = setTimeout(done, 0);
      });
    }
    function onGathering() {
      if (pc.iceGatheringState === "complete") done();
    }
    pc.addEventListener("icecandidate", onCandidate);
    pc.addEventListener("icegatheringstatechange", onGathering);
    signal.addEventListener("abort", done, { once: true });
    if (signal.aborted || ready()) done();
  });
}

export function connectionFailureReason(relay: boolean): string {
  return relay
    ? "Peer connection failed; inspect ICE and the configured TURN relay."
    : "Peer connection failed. No TURN relay is configured; TURN is needed when either network blocks direct connections.";
}

/** Every request has both an owner and a deadline, including body consumption. */
async function request<T>(
  url: string,
  init: RequestInit,
  consume: (response: Response) => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, REQUEST_TIMEOUT_MS);
  try {
    return await consume(await fetch(url, { ...init, signal: controller.signal }));
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

let iceConfig: IceConfig | null = null;

export async function loadIceConfig(signal?: AbortSignal): Promise<IceConfig> {
  if (iceConfig) return iceConfig;
  try {
    const config = await request<IceConfig | null>(
      "/api/webrtc/ice",
      { cache: "no-store" },
      async (response) => (response.ok ? response.json() : null),
      signal,
    );
    // Failed requests are not cached: a temporary outage must not remove TURN
    // for the rest of this page's lifetime.
    if (config) iceConfig = config;
    return config ?? { iceServers: [], relay: false };
  } catch {
    return { iceServers: [], relay: false };
  }
}

export async function sendSignal(
  sourceId: string,
  post: SignalPost,
  signal?: AbortSignal,
): Promise<boolean> {
  try {
    return await request(
      `/api/webrtc/${encodeURIComponent(sourceId)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(post),
        cache: "no-store",
      },
      async (response) => response.ok,
      signal,
    );
  } catch {
    return false;
  }
}

/** Best effort, survives navigation; setup and media deadlines cover loss. */
export function sendBye(sourceId: string, from: string, to: string): void {
  try {
    void fetch(`/api/webrtc/${encodeURIComponent(sourceId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "bye", from, to }),
      cache: "no-store",
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // Navigation may already have destroyed the execution context.
  }
}

export async function fetchSignals(
  sourceId: string,
  since: string,
  peerId: string,
  signal?: AbortSignal,
): Promise<SignalPage | null> {
  try {
    const query = new URLSearchParams({ since, peer: peerId });
    return await request(
      `/api/webrtc/${encodeURIComponent(sourceId)}?${query}`,
      { cache: "no-store" },
      async (response) => (response.ok ? (response.json() as Promise<SignalPage>) : null),
      signal,
    );
  } catch {
    return null;
  }
}

/** The mailbox deliberately overlaps reads to catch delayed blob visibility. */
export function createSignalDeduplicator(): (message: SignalMessage) => boolean {
  const seen = new Map<string, number>();
  return (message) => {
    const earliest = Date.now() - 35_000;
    for (const [cursor, at] of seen) if (at < earliest) seen.delete(cursor);
    if (seen.has(message.cursor)) return false;
    seen.set(message.cursor, message.at);
    return true;
  };
}

const senderOperations = new WeakMap<RTCRtpSender, Promise<void>>();

/** setParameters and replaceTrack must never race on the same sender. */
export function updateSender(sender: RTCRtpSender, operation: () => Promise<void>): Promise<void> {
  const next = (senderOperations.get(sender) ?? Promise.resolve())
    .catch(() => undefined)
    .then(operation);
  senderOperations.set(sender, next);
  return next;
}

/** Re-read parameters for each attempt; fall back if optional controls fail. */
export async function capBitrate(
  pc: RTCPeerConnection,
  bitrate = MAX_BITRATE,
  onIssue: (message: string) => void = console.warn,
): Promise<void> {
  const sender = pc.getSenders().find((candidate) => candidate.track?.kind === "video");
  if (!sender) return;
  await updateSender(sender, async () => {
    if (pc.signalingState === "closed") return;
    const apply = async (withQualityHints: boolean) => {
      const parameters = sender.getParameters();
      if (!parameters.encodings?.length) throw new Error("No negotiated video encoding");
      const encodingBudget = Math.floor(bitrate / parameters.encodings.length);
      for (const encoding of parameters.encodings) {
        encoding.maxBitrate = encodingBudget;
        if (withQualityHints) {
          encoding.maxFramerate = MAX_FRAMERATE;
          const { width = 1280, height = 720 } = sender.track?.getSettings() ?? {};
          encoding.scaleResolutionDownBy = Math.max(
            1,
            Math.max(width, height) / 1280,
            Math.min(width, height) / 720,
          );
        }
      }
      if (withQualityHints) parameters.degradationPreference = "maintain-framerate";
      await sender.setParameters(parameters);
    };
    try {
      await apply(true);
    } catch (error) {
      if (isDead(pc.connectionState)) return;
      onIssue(`Video quality controls unavailable; retrying bitrate only (${String(error)}).`);
      try {
        await apply(false);
      } catch (fallbackError) {
        onIssue(`Video bitrate cap could not be applied: ${String(fallbackError)}`);
        return;
      }
    }
    const encodings = sender.getParameters().encodings;
    if (
      !encodings?.length ||
      encodings.some((encoding) => encoding.maxBitrate == null) ||
      encodings.reduce((sum, encoding) => sum + (encoding.maxBitrate ?? 0), 0) > bitrate
    )
      onIssue(`Browser did not retain the requested ${bitrate} bps video cap.`);
  });
}

export function closePeer(pc: RTCPeerConnection | null): void {
  if (!pc) return;
  pc.ontrack = null;
  pc.onconnectionstatechange = null;
  pc.onicecandidate = null;
  try {
    pc.close();
  } catch {
    // Already closed.
  }
}

export function isDead(state: RTCPeerConnectionState): boolean {
  return state === "failed" || state === "closed";
}
