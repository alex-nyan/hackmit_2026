import { describe, expect, it, vi } from "vitest";

import { forwardClip } from "./transcribeProxy";
import type { TriageSettings } from "./triageProxy";

const SETTINGS: TriageSettings = {
  baseUrl: "http://127.0.0.1:8099",
  token: "a".repeat(32),
  timeoutMs: 240_000,
};
const BODY = JSON.stringify({ audio_base64: "AAA", media_type: "audio/mp4" });

function upstream(status: number, body: string) {
  return vi.fn(async () => new Response(body, { status }));
}

describe("forwarding a clip", () => {
  it("posts to the transcription endpoint with the bearer token", async () => {
    const fetchMock = upstream(200, '{"text":"hello"}');
    await forwardClip(SETTINGS, BODY, fetchMock as unknown as typeof fetch);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:8099/v1/transcribe");
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${SETTINGS.token}`);
    expect(init.cache).toBe("no-store");
  });

  it("returns the transcript unchanged on success", async () => {
    const transcript = '{"request_id":"r1","text":"dispatch","speech_detected":true}';
    const outcome = await forwardClip(
      SETTINGS,
      BODY,
      upstream(200, transcript) as unknown as typeof fetch,
    );
    expect(outcome).toEqual({ status: 200, body: transcript });
  });

  it("measures the limit in bytes, not UTF-16 length", async () => {
    const fetchMock = upstream(200, "{}");
    // Multi-byte characters make a string shorter than the bytes it encodes to.
    const body = "\u00e9".repeat(6_000_000);
    expect(body.length).toBeLessThan(11_300_001);
    const outcome = await forwardClip(SETTINGS, body, fetchMock as unknown as typeof fetch);
    expect(outcome.status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an oversized clip without calling the service", async () => {
    const fetchMock = upstream(200, "{}");
    const outcome = await forwardClip(
      SETTINGS,
      "x".repeat(11_300_001),
      fetchMock as unknown as typeof fetch,
    );
    expect(outcome.status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never relays an upstream failure body to the browser", async () => {
    const leaky = `{"detail":"token ${SETTINGS.token} rejected"}`;
    const outcome = await forwardClip(
      SETTINGS,
      BODY,
      upstream(401, leaky) as unknown as typeof fetch,
    );
    expect(outcome.status).toBe(401);
    expect(outcome.body).not.toContain(SETTINGS.token);
    expect(JSON.parse(outcome.body)).toEqual({ error: "upstream", status: 401 });
  });

  it("passes a disabled service through as its own status", async () => {
    const outcome = await forwardClip(
      SETTINGS,
      BODY,
      upstream(503, '{"error":{"code":"transcription_disabled"}}') as unknown as typeof fetch,
    );
    expect(outcome.status).toBe(503);
  });

  it("distinguishes a timeout from an unreachable service", async () => {
    const timeout = await forwardClip(SETTINGS, BODY, (async () => {
      const error = new Error("timed out");
      error.name = "TimeoutError";
      throw error;
    }) as unknown as typeof fetch);
    expect(JSON.parse(timeout.body).error).toBe("upstream-timeout");

    const refused = await forwardClip(SETTINGS, BODY, (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch);
    expect(JSON.parse(refused.body).error).toBe("upstream-unreachable");
  });
});
