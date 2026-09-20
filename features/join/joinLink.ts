import "server-only";

import QRCode from "qrcode";

import { joinUrl, readOrigin, type JoinLink } from "./origin";

/**
 * The address a phone is asked to open, rendered as something it can scan.
 *
 * The encoder stays on the server: the browser has no reason to carry one, and
 * the URL being encoded is one the server derived from the request rather than
 * anything a client supplied.
 */

/**
 * `Q` rather than the usual `M`, and a tight quiet zone.
 *
 * This code is read off a screen from across a table, at an angle, by a phone
 * held one-handed. The extra error correction costs a few modules and buys back
 * every one of them. The card supplies the light margin a scanner needs, so the
 * SVG does not also carry one.
 */
async function render(url: string): Promise<string> {
  return QRCode.toString(url, {
    type: "svg",
    errorCorrectionLevel: "Q",
    margin: 1,
    color: { dark: "#0d1216ff", light: "#ffffffff" },
  });
}

export async function buildJoinLink(headers: Headers): Promise<JoinLink | null> {
  const resolved = readOrigin(headers);
  if (!resolved) return null;

  const url = joinUrl(resolved.origin);
  return {
    url,
    joinability: resolved.joinability,
    // A code nobody can act on is worse than no code: it invites a scan and
    // then wastes it. The card explains the problem in words instead.
    qrSvg: resolved.joinability === "ok" ? await render(url) : null,
  };
}

export { JOIN_PATH } from "./origin";
export type { JoinLink, Joinability } from "./origin";
