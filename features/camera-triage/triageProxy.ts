export interface TriageSettings {
  baseUrl: string;
  token: string;
}

const REQUEST_TIMEOUT_MS = 30_000;
/** Matches the service's own request ceiling, rejecting oversized bodies early. */
export const MAX_BODY_BYTES = 11_300_000;
export const KEY_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/;

export function readTriageSettings(env: Record<string, string | undefined>): TriageSettings | null {
  const baseUrl = env.TRIAGE_URL?.trim();
  const token = env.TRIAGE_API_TOKEN?.trim();
  if (!baseUrl || !token) return null;
  return { baseUrl: baseUrl.replace(/\/+$/, ""), token };
}

export interface ProxyOutcome {
  status: number;
  body: string;
  json: boolean;
}

/**
 * Forwards one frame to the triage service with the bearer token attached.
 * Upstream failure bodies are dropped rather than relayed, because they can
 * echo request detail back to a browser that must never see it.
 */
export async function forwardFrame(
  settings: TriageSettings,
  idempotencyKey: string,
  body: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ProxyOutcome> {
  if (!KEY_PATTERN.test(idempotencyKey)) {
    return { status: 400, body: JSON.stringify({ error: "invalid-idempotency-key" }), json: true };
  }
  if (body.length > MAX_BODY_BYTES) {
    return { status: 413, body: JSON.stringify({ error: "frame-too-large" }), json: true };
  }

  try {
    const upstream = await fetchImpl(`${settings.baseUrl}/v1/triage`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${settings.token}`,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });

    if (!upstream.ok) {
      // The status is passed through so the client can back off on 429.
      return {
        status: upstream.status,
        body: JSON.stringify({ error: "upstream", status: upstream.status }),
        json: true,
      };
    }

    return { status: 200, body: await upstream.text(), json: true };
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    return {
      status: 504,
      body: JSON.stringify({ error: timedOut ? "upstream-timeout" : "upstream-unreachable" }),
      json: true,
    };
  }
}
