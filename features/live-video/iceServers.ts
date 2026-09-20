/**
 * How a browser is told to find a route to the other one.
 *
 * STUN is enough whenever the two peers can address each other once they know
 * their public pairs — the same Wi-Fi, or two ordinary home networks. It is
 * free, stateless and needs no account, so it is always on.
 *
 * TURN is the one that costs money and the one a conference network makes
 * necessary. Guest Wi-Fi commonly isolates clients from each other, and then
 * two devices on the same SSID cannot exchange a packet no matter how well
 * they have described themselves; the media has to go out to a relay and back.
 * It is configured rather than assumed, and the deployment says whether it has
 * one instead of the browser discovering the hard way.
 */

export interface IceConfig {
  iceServers: RTCIceServer[];
  /** Whether a relay is available, so a watcher can explain a failure. */
  relay: boolean;
}

/** Google's public STUN. No account, no data, and it only reflects an address. */
const DEFAULT_STUN = "stun:stun.l.google.com:19302";

function urls(value: string | undefined, fallback = ""): string[] {
  return (value ?? fallback)
    .split(",")
    .map((url) => url.trim())
    .filter(Boolean);
}

export function readIceServers(env: Record<string, string | undefined>): IceConfig {
  const iceServers: RTCIceServer[] = [];

  const stun = urls(env.PAW_PATROL_STUN_URLS, DEFAULT_STUN);
  if (stun.length > 0) iceServers.push({ urls: stun });

  const turn = urls(env.PAW_PATROL_TURN_URLS);
  const username = env.PAW_PATROL_TURN_USERNAME?.trim();
  const credential = env.PAW_PATROL_TURN_CREDENTIAL?.trim();
  // A relay without credentials is not a relay, and offering it would only
  // make gathering wait for an authentication that is never going to succeed.
  const relay = turn.length > 0 && Boolean(username) && Boolean(credential);
  if (relay) iceServers.push({ urls: turn, username, credential });

  return { iceServers, relay };
}
