"use client";

import type { IceConfig } from "./iceServers";
import type { SignalPage, SignalPost } from "./signal";

/**
 * The browser-side half of the handshake: everything both roles do the same
 * way, kept out of the two hooks so they only hold what makes them different.
 */

/**
 * How long to let ICE gathering run before sending what we have.
 *
 * Candidates are sent inside the SDP rather than trickled, which costs one
 * wait per connection. On a LAN the host candidates are there in a few
 * milliseconds and this never fires; it exists for the case where a STUN or
 * relay server is slow or unreachable, where waiting for a complete gather
 * would stall a connection that the local candidates could have made anyway.
 */
export const GATHER_MS = 1_500;

/** Fast while a handshake is in flight; nothing is polling once it lands. */
export const HANDSHAKE_POLL_MS = 300;

/**
 * A publisher's idle cadence. It is not waiting for anything in particular —
 * only for someone new to start watching — so this is the cost of being
 * findable, paid once a second so new viewers connect promptly.
 */
export const PUBLISHER_POLL_MS = 1_000;

/** Past this a handshake has not worked and is worth starting over. */
export const CONNECT_TIMEOUT_MS = 9_000;

/** Between attempts, so a source with no publisher is not polled hot. */
export const RETRY_MS = 5_000;

/**
 * Offers older than this are not worth answering: the browser that sent one
 * has either connected by now or given up and asked again under a new name.
 */
export const OFFER_FRESH_MS = 15_000;

/**
 * A ceiling on what one camera sends, per watcher.
 *
 * WebRTC will otherwise discover the limit by reaching it, which on a
 * congested network means the whole room's connections degrade together. The
 * number is chosen for a body camera on conference Wi-Fi rather than for
 * picture quality: this is a view of a scene, not footage anyone will grade.
 */
export const MAX_BITRATE = 2_000_000;

/**
 * Continuity Camera can expose 60 fps. Keeping the direct stream at 30 fps
 * avoids spending bandwidth and encoder time on frames the wall cannot use.
 */
export const MAX_FRAMERATE = 30;

/**
 * How many browsers one camera will serve.
 *
 * Every watcher is a separate encode on the publishing machine, so a wall
 * that everybody opens is a laptop that overheats. Past this, the later
 * watchers keep the frame tile, which is the whole reason it was left in.
 */
export const MAX_WATCHERS = 4;

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let iceConfig: Promise<IceConfig> | null = null;

/**
 * Fetched once per page rather than per connection. Credentials do not change
 * underneath a session, and a watcher retrying every five seconds should not
 * be asking for them every five seconds.
 */
export function loadIceConfig(): Promise<IceConfig> {
  iceConfig ??= fetch("/api/webrtc/ice", { cache: "no-store" })
    .then((response) => (response.ok ? response.json() : null))
    .then((body: IceConfig | null) => body ?? { iceServers: [], relay: false })
    .catch(() => ({ iceServers: [], relay: false }) satisfies IceConfig);
  return iceConfig;
}

/**
 * Resolves once the connection has described every route it can offer, or
 * once the wait has gone on long enough to be worth cutting short.
 */
export function gathered(pc: RTCPeerConnection, timeoutMs = GATHER_MS): Promise<void> {
  if (pc.iceGatheringState === "complete") return Promise.resolve();

  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      pc.removeEventListener("icegatheringstatechange", onChange);
      resolve();
    };
    const onChange = () => {
      if (pc.iceGatheringState === "complete") done();
    };
    const timer = setTimeout(done, timeoutMs);
    pc.addEventListener("icegatheringstatechange", onChange);
  });
}

export async function sendSignal(sourceId: string, post: SignalPost): Promise<boolean> {
  try {
    const response = await fetch(`/api/webrtc/${encodeURIComponent(sourceId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(post),
      cache: "no-store",
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * A farewell on the way out, sent with `keepalive` so it survives the page
 * that is closing. Nothing depends on it arriving — both sides time out — but
 * it turns a watcher closing a tab from a nine-second stall into an instant
 * teardown on the publisher.
 */
export function sendBye(sourceId: string, from: string, to: string): void {
  const body = JSON.stringify({ kind: "bye", from, to });
  try {
    void fetch(`/api/webrtc/${encodeURIComponent(sourceId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      cache: "no-store",
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // A page being torn down is not a place to report anything.
  }
}

export async function fetchSignals(
  sourceId: string,
  since: string,
  peerId: string,
): Promise<SignalPage | null> {
  try {
    const query = new URLSearchParams({ since, peer: peerId });
    const response = await fetch(`/api/webrtc/${encodeURIComponent(sourceId)}?${query}`, {
      cache: "no-store",
    });
    if (!response.ok) return null;
    return (await response.json()) as SignalPage;
  } catch {
    return null;
  }
}

/**
 * Holds the outgoing video inside a budget.
 *
 * Called after the local description is set, because that is when the browser
 * has actually created the encoding this is trying to configure.
 */
export async function capBitrate(pc: RTCPeerConnection, bitrate = MAX_BITRATE): Promise<void> {
  const sender = pc.getSenders().find((candidate) => candidate.track?.kind === "video");
  if (!sender) return;

  try {
    const parameters = sender.getParameters();
    parameters.encodings = parameters.encodings?.length ? parameters.encodings : [{}];
    parameters.encodings[0].maxBitrate = bitrate;
    parameters.encodings[0].maxFramerate = MAX_FRAMERATE;
    // Bound each viewer's encode to 720p while retaining the original camera
    // resolution for local preview and triage snapshots.
    const { width = 1280, height = 720 } = sender.track?.getSettings() ?? {};
    parameters.encodings[0].scaleResolutionDownBy = Math.max(
      1,
      Math.max(width, height) / 1280,
      Math.min(width, height) / 720,
    );
    // On a congested link, reduce detail before sacrificing motion.
    parameters.degradationPreference = "maintain-framerate";
    await sender.setParameters(parameters);
  } catch {
    // Every browser allows some of this and none allows all of it. An
    // uncapped connection still works; it is only less polite.
  }
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

/** The states a connection does not come back from on its own. */
export function isDead(state: RTCPeerConnectionState): boolean {
  return state === "failed" || state === "closed" || state === "disconnected";
}
