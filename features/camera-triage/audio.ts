import type {
  TranscriptionRequest as TranscriptionRequestBody,
  TranscriptionResult,
} from "../../shared/contracts";
import { toSourceId } from "./frame";

export type {
  TranscriptionRequest as TranscriptionRequestBody,
  TranscriptionResult,
  TranscriptSegment,
} from "../../shared/contracts";
export type AudioMediaType = TranscriptionRequestBody["media_type"];

export const MAX_AUDIO_BASE64 = 11_200_000;

/**
 * Candidate recording formats in preference order. Safari records AAC in an
 * MP4 container and cannot record WebM, so a Chrome-shaped list would silently
 * produce nothing on an iPhone.
 */
export const RECORDER_MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/mp4;codecs=mp4a.40.2",
  "audio/ogg;codecs=opus",
] as const;

/** Reduces a MediaRecorder mime type to the media type the service accepts. */
export function toServiceMediaType(recorderMimeType: string): AudioMediaType | null {
  const base = recorderMimeType.split(";", 1)[0]?.trim().toLowerCase();
  switch (base) {
    case "audio/mp4":
    case "audio/x-m4a":
      return "audio/mp4";
    case "audio/aac":
      return "audio/aac";
    case "audio/mpeg":
      return "audio/mpeg";
    case "audio/wav":
    case "audio/wave":
      return "audio/wav";
    case "audio/webm":
      return "audio/webm";
    case "audio/ogg":
      return "audio/ogg";
    default:
      return null;
  }
}

/**
 * Picks a format this browser can actually record. Returns null when none work,
 * so the caller can say so rather than record into the void.
 */
export function pickRecorderMimeType(
  isSupported: (mimeType: string) => boolean,
  candidates: readonly string[] = RECORDER_MIME_CANDIDATES,
): string | null {
  for (const candidate of candidates) {
    if (isSupported(candidate) && toServiceMediaType(candidate)) return candidate;
  }
  return null;
}

/** Strips the data URL wrapper FileReader produces, leaving raw base64. */
export function stripAudioDataUrl(dataUrl: string): string | null {
  const match = /^data:[^,]*;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  return match ? match[1] : null;
}

export function buildTranscriptionRequest(options: {
  dataUrl: string;
  recorderMimeType: string;
  sourceId: string;
  capturedAt: Date;
  incidentId?: string | null;
  language?: string | null;
}): TranscriptionRequestBody | null {
  const audio_base64 = stripAudioDataUrl(options.dataUrl);
  if (!audio_base64) return null;
  if (audio_base64.length > MAX_AUDIO_BASE64) return null;

  const media_type = toServiceMediaType(options.recorderMimeType);
  if (!media_type) return null;

  return {
    audio_base64,
    media_type,
    source_id: toSourceId(options.sourceId),
    captured_at: options.capturedAt.toISOString(),
    incident_id: options.incidentId ?? null,
    language: options.language ?? null,
  };
}

/**
 * A transcript is a model hypothesis. Empty text means nothing was recognised,
 * which is not the same as nothing having been said; the caller shows the
 * difference rather than an empty quotation.
 */
export function describeTranscript(result: TranscriptionResult): string {
  if (result.speech_detected && result.text) return result.text;
  return "No speech recognised in this clip.";
}
