// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/triage/route";
import { POST as transcribe } from "@/app/api/transcribe/route";

import { readFrameBody } from "./readFrameBody";

function streamedRequest(body: ReadableStream<Uint8Array>, headers?: HeadersInit) {
  return new Request("http://localhost/api/triage", {
    method: "POST",
    body,
    headers,
    duplex: "half",
  } as RequestInit);
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("bounded frame body", () => {
  it.each(["request", "response"] as const)(
    "cancels an oversized %s stream without Content-Length",
    async (kind) => {
      const cancel = vi.fn();
      let chunksRead = 0;
      const stream = new ReadableStream<Uint8Array>(
        {
          pull(controller) {
            chunksRead += 1;
            controller.enqueue(new Uint8Array(4));
          },
          cancel,
        },
        { highWaterMark: 0 },
      );

      const input = kind === "request" ? streamedRequest(stream) : new Response(stream);
      expect(await readFrameBody(input, 8)).toEqual({
        ok: false,
        status: 413,
        error: "frame-too-large",
      });
      expect(chunksRead).toBe(3);
      expect(cancel).toHaveBeenCalledOnce();
    },
  );

  it("checks streamed bytes even when Content-Length understates the body", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(9));
        controller.close();
      },
    });

    expect(
      await readFrameBody(streamedRequest(stream, { "Content-Length": "1" }), 8),
    ).toMatchObject({ ok: false, status: 413 });
  });

  it("counts UTF-8 bytes and preserves characters split across chunks", async () => {
    const bytes = new TextEncoder().encode("é");
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, 1));
        controller.enqueue(bytes.slice(1));
        controller.close();
      },
    });

    expect(await readFrameBody(streamedRequest(stream), 2)).toEqual({ ok: true, body: "é" });
    expect(
      await readFrameBody(new Request("http://localhost", { method: "POST", body: "é" }), 1),
    ).toMatchObject({ ok: false, status: 413 });
  });

  it("sanitizes interrupted body reads", async () => {
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error("private transport details"));
      },
    });

    expect(await readFrameBody(streamedRequest(stream), 8)).toEqual({
      ok: false,
      status: 400,
      error: "invalid-request-body",
    });
  });

  it.each([
    { name: "triage", post: POST, error: "frame-too-large" },
    { name: "transcribe", post: transcribe, error: "clip-too-large" },
  ])(
    "rejects a declared oversized body at $name before reading or forwarding",
    async ({ post, error }) => {
      vi.stubEnv("TRIAGE_URL", "http://127.0.0.1:8090");
      vi.stubEnv("TRIAGE_API_TOKEN", "test-token");
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      const pull = vi.fn();
      const stream = new ReadableStream<Uint8Array>({ pull }, { highWaterMark: 0 });
      const response = await post(
        streamedRequest(stream, { "Content-Length": "11300001", "Idempotency-Key": "frame-1" }),
      );

      expect(response.status).toBe(413);
      expect(await response.json()).toEqual({ error });
      expect(pull).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );
});
