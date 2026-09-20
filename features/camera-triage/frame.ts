import type { TriageRequestBody } from "./types";

/** The service requires ^[A-Za-z0-9_.:-]{1,128}$ for both of these. */
const TOKEN_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/;

/** Base64 payload ceiling from the request schema. */
export const MAX_IMAGE_BASE64 = 11_200_000;

export function isValidToken(value: string): boolean {
  return TOKEN_PATTERN.test(value);
}

/**
 * Derives a source id the service will accept from free text, so a person can
 * type "Unit 02" without learning the pattern.
 */
export function toSourceId(raw: string): string {
  const cleaned = raw
    .trim()
    .replace(/[^A-Za-z0-9_.:-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 128);
  return cleaned || "unknown-source";
}

/** Strips the data URL prefix Canvas produces, leaving raw base64. */
export function stripDataUrl(dataUrl: string): string | null {
  const match = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  return match ? match[1] : null;
}

export function buildTriageRequest(options: {
  dataUrl: string;
  sourceId: string;
  capturedAt: Date;
  incidentId?: string | null;
}): TriageRequestBody | null {
  const image_base64 = stripDataUrl(options.dataUrl);
  if (!image_base64) return null;
  // Refuse rather than let the service reject a frame it already paid to read.
  if (image_base64.length > MAX_IMAGE_BASE64) return null;

  return {
    image_base64,
    media_type: "image/jpeg",
    source_id: toSourceId(options.sourceId),
    captured_at: options.capturedAt.toISOString(),
    incident_id: options.incidentId ?? null,
    allow_cloud: false,
  };
}

export type FrameOutcome = "ok" | "busy" | "unconfigured" | "error";

/**
 * Back-pressure. The service admits one frame at a time and answers 429 when
 * busy, so a fixed interval would just queue frames until they went stale.
 *
 * A deployment with no triage service behind it is not a failure to back off
 * from: the capture still feeds the body camera wall, and slowing it down
 * would only make the wall staler for everyone watching.
 */
export function nextDelayMs(outcome: FrameOutcome, baseMs: number): number {
  if (outcome === "ok" || outcome === "unconfigured") return baseMs;
  if (outcome === "busy") return Math.max(baseMs, 1500);
  return Math.max(baseMs, 3000);
}
