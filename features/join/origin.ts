/**
 * Where a phone would have to go, and whether it could get there.
 *
 * A QR code is a promise that scanning it will work, so the two ways it cannot
 * are worth knowing before one is drawn. A dashboard on `localhost` is not
 * addressable from anybody else's phone at all. A dashboard on a plain-HTTP LAN
 * address is addressable, but the browser will refuse geolocation on it — which
 * fails after the scan, on the phone, and looks like the app is broken.
 *
 * Kept apart from the encoder so it can be tested without one.
 */

export const JOIN_PATH = "/join";

export type Joinability =
  /** Reachable and a secure context: the code will work. */
  | "ok"
  /** Only this machine can open it. Another phone cannot. */
  | "loopback"
  /** Reachable, but plain HTTP, so the browser refuses location. */
  | "insecure";

export interface ResolvedOrigin {
  origin: string;
  joinability: Joinability;
}

/**
 * What the dashboard renders. The shape lives here rather than beside the
 * encoder so that a client component can name it without its import graph
 * reaching a server-only module.
 */
export interface JoinLink {
  url: string;
  joinability: Joinability;
  /** Rendered only when scanning could actually succeed. */
  qrSvg: string | null;
}

export function isLoopback(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host === "::1") return true;
  return /^127\./.test(host);
}

/**
 * The origin this request actually arrived on.
 *
 * Behind a proxy the `Host` header is the internal one, so a forwarded pair
 * wins where it is present. Vercel sets both; a bare `next start` sets neither
 * and `Host` is already the right answer.
 */
export function readOrigin(headers: Headers): ResolvedOrigin | null {
  const host = headers.get("x-forwarded-host")?.trim() || headers.get("host")?.trim();
  if (!host) return null;

  // A forwarding proxy may list several; the first is the original client hop.
  const forwardedProto = headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const hostname = host.replace(/:\d+$/, "");
  const loopback = isLoopback(hostname);
  const protocol = forwardedProto || (loopback ? "http" : "https");
  const origin = `${protocol}://${host}`;

  if (loopback) return { origin, joinability: "loopback" };
  // The browser's own rule, applied here so the failure is visible on the
  // dashboard rather than on somebody's phone after they have already scanned.
  if (protocol !== "https") return { origin, joinability: "insecure" };
  return { origin, joinability: "ok" };
}

export function joinUrl(origin: string): string {
  return `${origin}${JOIN_PATH}`;
}
