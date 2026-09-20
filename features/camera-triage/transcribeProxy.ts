import { MAX_BODY_BYTES, REQUEST_TIMEOUT_MS, type TriageSettings } from "./triageProxy";

export interface ClipProxyOutcome {
  status: number;
  body: string;
}

/**
 * Forwards one audio clip to the triage service with the bearer token attached.
 * As with frames, upstream failure bodies are dropped rather than relayed.
 */
export async function forwardClip(
  settings: TriageSettings,
  body: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ClipProxyOutcome> {
  // Byte length, not string length: the limit the service enforces is bytes.
  if (new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES) {
    return { status: 413, body: JSON.stringify({ error: "clip-too-large" }) };
  }

  try {
    const upstream = await fetchImpl(`${settings.baseUrl}/v1/transcribe`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${settings.token}`,
        "Content-Type": "application/json",
      },
      body,
      // Transcription shares the configured inference budget.
      signal: AbortSignal.timeout(settings.timeoutMs ?? REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });

    if (!upstream.ok) {
      return {
        status: upstream.status,
        body: JSON.stringify({ error: "upstream", status: upstream.status }),
      };
    }
    return { status: 200, body: await upstream.text() };
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    return {
      status: 504,
      body: JSON.stringify({ error: timedOut ? "upstream-timeout" : "upstream-unreachable" }),
    };
  }
}
