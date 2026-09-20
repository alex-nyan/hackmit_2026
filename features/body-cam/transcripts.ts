import { get, put } from "@vercel/blob";

import { isValidToken } from "@/features/camera-triage/frame";

/**
 * The latest thing each officer's microphone was heard to say.
 *
 * Kept beside the wall rather than inside it: a transcript arrives on its own
 * schedule, is far smaller than a frame, and a tile should be able to show
 * one without waiting for the next picture.
 *
 * Only the latest is kept, and it ages out with the same window the wall
 * uses, because a transcript from ten minutes ago sitting under a live tile
 * would read as something the officer just said. It is a machine transcript
 * either way, which the dashboard says plainly.
 */

const PREFIX = "transcripts/";
/** A transcript older than its tile would misdescribe what is on screen. */
export const TRANSCRIPT_TTL_MS = 60_000;
const MAX_TEXT = 400;

export interface Transcript {
  sourceId: string;
  text: string;
  at: string;
}

function transcriptPath(sourceId: string): string {
  return `${PREFIX}${sourceId}.json`;
}

/** Reads a transcription response as something worth showing. */
export function parseTranscript(raw: unknown): string | null {
  if (typeof raw !== "object" || raw === null) return null;
  const body = raw as Record<string, unknown>;
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) return null;
  return text.slice(0, MAX_TEXT);
}

export async function publishTranscript(
  sourceId: string,
  text: string,
  now: Date = new Date(),
): Promise<void> {
  if (!isValidToken(sourceId)) return;
  const record: Transcript = { sourceId, text, at: now.toISOString() };
  await put(transcriptPath(sourceId), JSON.stringify(record), {
    access: "private",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
  });
}

export async function readTranscript(
  sourceId: string,
  nowMs: number = Date.now(),
): Promise<Transcript | null> {
  const found = await get(transcriptPath(sourceId), { access: "private", useCache: false });
  if (!found?.stream) return null;

  try {
    const record = JSON.parse(await new Response(found.stream).text()) as Transcript;
    if (typeof record?.text !== "string" || typeof record.at !== "string") return null;
    const at = Date.parse(record.at);
    if (Number.isNaN(at) || nowMs - at > TRANSCRIPT_TTL_MS) return null;
    return record;
  } catch {
    return null;
  }
}
