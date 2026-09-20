import { readFrameBody } from "./readFrameBody";

const SERVICE_MESSAGES: Record<string, string> = {
  "not-configured":
    "Camera and audio processing are not configured on the server. The local preview still works.",
  "upstream-unreachable": "The processing service is offline. The local preview still works.",
  "upstream-timeout": "Processing took too long. Please try again.",
  transcription_disabled: "Audio transcription is disabled on the processing server.",
  transcriber_disabled: "Audio transcription is disabled on the processing server.",
  transcriber_unavailable: "The speech model is unavailable on the processing server.",
  transcriber_failed: "The speech model could not process this clip. Please try again.",
  transcriber_invalid_output: "The speech model returned an invalid result. Please try again.",
  transcription_unavailable: "Audio transcription is unavailable. Check the processing service.",
  triage_unavailable: "Video analysis is unavailable. Check the processing service.",
  result_store_unavailable: "The processing service cannot save results. Check its storage.",
  service_busy: "The processing service is busy. Capture will retry automatically.",
};

/** Keep only known error codes; never expose upstream text, media, or credentials. */
export async function upstreamErrorBody(response: Response): Promise<string> {
  const result: { error: string; status: number; code?: string } = {
    error: "upstream",
    status: response.status,
  };
  const raw = await readFrameBody(response, 4096);
  if (raw.ok) {
    try {
      const parsed = JSON.parse(raw.body);
      const code: unknown = parsed?.error?.code;
      if (typeof code === "string" && Object.hasOwn(SERVICE_MESSAGES, code)) result.code = code;
    } catch {
      // HTML, malformed JSON, and unrecognized messages remain generic.
    }
  }
  return JSON.stringify(result);
}

export async function captureErrorMessage(
  response: Response,
  kind: "Video analysis" | "Transcription",
): Promise<string> {
  try {
    const parsed = await response.json();
    const code: unknown = parsed?.code ?? parsed?.error;
    if (typeof code === "string" && Object.hasOwn(SERVICE_MESSAGES, code))
      return SERVICE_MESSAGES[code];
  } catch {
    // The HTTP status is still useful if a proxy returned an HTML error page.
  }
  if (response.status === 401 || response.status === 403)
    return "The processing service rejected its server credentials. Check the server configuration.";
  if (response.status === 429) return SERVICE_MESSAGES.service_busy;
  return `${kind} is unavailable (HTTP ${response.status}). The local preview is independent of processing.`;
}
