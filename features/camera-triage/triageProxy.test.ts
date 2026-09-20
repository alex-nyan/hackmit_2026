import { describe, expect, it, vi } from "vitest";

import { triageFixture } from "../contracts/fixtures";
import { forwardFrame, readTriageSettings, type TriageSettings } from "./triageProxy";

const SETTINGS: TriageSettings = {
  baseUrl: "http://127.0.0.1:8090",
  token: "a".repeat(32),
};

const KEY = "11111111-2222-3333-4444-555555555555";
const BODY = JSON.stringify({ image_base64: "AAA", media_type: "image/jpeg" });

function upstream(status: number, body: string) {
  return vi.fn(
    async () => new Response(body, { status, headers: { "Content-Type": "application/json" } }),
  );
}

describe("settings", () => {
  it("reads a complete configuration and trims the trailing slash", () => {
    expect(
      readTriageSettings({ TRIAGE_URL: "http://127.0.0.1:8090/", TRIAGE_API_TOKEN: "t" }),
    ).toEqual({ baseUrl: "http://127.0.0.1:8090", token: "t", timeoutMs: 240_000 });
  });

  it("allows a longer inference deadline for slower providers", () => {
    expect(
      readTriageSettings({
        TRIAGE_URL: SETTINGS.baseUrl,
        TRIAGE_API_TOKEN: SETTINGS.token,
        TRIAGE_TIMEOUT_SECONDS: "660",
      })?.timeoutMs,
    ).toBe(660_000);
  });

  it.each(["0", "-1", "Infinity", "invalid", "3601"])(
    "rejects an invalid timeout %s",
    (timeout) => {
      expect(
        readTriageSettings({
          TRIAGE_URL: SETTINGS.baseUrl,
          TRIAGE_API_TOKEN: SETTINGS.token,
          TRIAGE_TIMEOUT_SECONDS: timeout,
        }),
      ).toBeNull();
    },
  );

  it("treats an incomplete configuration as unconfigured", () => {
    expect(readTriageSettings({ TRIAGE_URL: "http://x" })).toBeNull();
    expect(readTriageSettings({ TRIAGE_API_TOKEN: "t" })).toBeNull();
    expect(readTriageSettings({ TRIAGE_URL: "  ", TRIAGE_API_TOKEN: "t" })).toBeNull();
    expect(readTriageSettings({})).toBeNull();
  });
});

describe("forwarding a frame", () => {
  it("allows normal inference to finish after the old 30-second deadline", async () => {
    vi.useFakeTimers();
    vi.spyOn(AbortSignal, "timeout").mockImplementation((delay) => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(new DOMException("Timed out", "TimeoutError")), delay);
      return controller.signal;
    });
    try {
      const pending = forwardFrame(SETTINGS, KEY, BODY, async (_url, init) => {
        return new Promise<Response>((resolve, reject) => {
          setTimeout(
            () =>
              resolve(new Response(JSON.stringify(triageFixture({ request_id: "slow-result" })))),
            31_000,
          );
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), {
            once: true,
          });
        });
      });
      await vi.advanceTimersByTimeAsync(31_000);
      expect(await pending).toMatchObject({
        status: 200,
        body: JSON.stringify(triageFixture({ request_id: "slow-result" })),
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("attaches the bearer token and the idempotency key", async () => {
    const fetchMock = upstream(200, '{"request_id":"r1"}');
    await forwardFrame(SETTINGS, KEY, BODY, fetchMock as unknown as typeof fetch);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:8090/v1/triage");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${SETTINGS.token}`);
    expect(headers["Idempotency-Key"]).toBe(KEY);
    expect(init.cache).toBe("no-store");
  });

  it("returns the triage result unchanged on success", async () => {
    const result = JSON.stringify(triageFixture());
    const outcome = await forwardFrame(
      SETTINGS,
      KEY,
      BODY,
      upstream(200, result) as unknown as typeof fetch,
    );
    expect(outcome).toEqual({ status: 200, body: result, json: true });
  });

  it.each(["{}", '{"requires_human_review":false}', "not json"])(
    "rejects malformed upstream success: %s",
    async (body) => {
      const outcome = await forwardFrame(
        SETTINGS,
        KEY,
        BODY,
        upstream(200, body) as unknown as typeof fetch,
      );
      expect(outcome).toEqual({
        status: 502,
        body: JSON.stringify({ error: "invalid-upstream-contract" }),
        json: true,
      });
    },
  );

  it("rejects a key the service would reject, without calling it", async () => {
    const fetchMock = upstream(200, "{}");
    const outcome = await forwardFrame(
      SETTINGS,
      "not a valid key",
      BODY,
      fetchMock as unknown as typeof fetch,
    );
    expect(outcome.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an oversized frame without calling the service", async () => {
    const fetchMock = upstream(200, "{}");
    const outcome = await forwardFrame(
      SETTINGS,
      KEY,
      "x".repeat(11_300_001),
      fetchMock as unknown as typeof fetch,
    );
    expect(outcome.status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("counts UTF-8 bytes instead of string characters toward the body limit", async () => {
    const fetchMock = upstream(200, "{}");
    const outcome = await forwardFrame(
      SETTINGS,
      KEY,
      "é".repeat(5_650_001),
      fetchMock as unknown as typeof fetch,
    );
    expect(outcome.status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("passes 429 through so the client can back off", async () => {
    const outcome = await forwardFrame(
      SETTINGS,
      KEY,
      BODY,
      upstream(429, '{"code":"service_busy"}') as unknown as typeof fetch,
    );
    expect(outcome.status).toBe(429);
  });

  it("never relays an upstream failure body to the browser", async () => {
    const leaky = '{"detail":"Bearer aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa rejected"}';
    const outcome = await forwardFrame(
      SETTINGS,
      KEY,
      BODY,
      upstream(401, leaky) as unknown as typeof fetch,
    );
    expect(outcome.status).toBe(401);
    expect(outcome.body).not.toContain(SETTINGS.token);
    expect(outcome.body).not.toContain("Bearer");
    expect(JSON.parse(outcome.body)).toEqual({ error: "upstream", status: 401 });
  });

  it("reports an unreachable service as a gateway timeout", async () => {
    const outcome = await forwardFrame(SETTINGS, KEY, BODY, (async () => {
      throw new Error("connect ECONNREFUSED");
    }) as unknown as typeof fetch);
    expect(outcome.status).toBe(504);
    expect(JSON.parse(outcome.body).error).toBe("upstream-unreachable");
  });

  it("distinguishes a timeout from an unreachable service", async () => {
    const outcome = await forwardFrame(SETTINGS, KEY, BODY, (async () => {
      const error = new Error("timed out");
      error.name = "TimeoutError";
      throw error;
    }) as unknown as typeof fetch);
    expect(JSON.parse(outcome.body).error).toBe("upstream-timeout");
  });
});
