import { describe, expect, it } from "vitest";
import { captureErrorMessage, upstreamErrorBody } from "./serviceErrors";

describe("processing failure diagnostics", () => {
  it("preserves a known service code without leaking upstream details", async () => {
    const body = await upstreamErrorBody(
      Response.json(
        {
          error: { code: "transcription_disabled", detail: "secret-token" },
          token: "secret-token",
        },
        { status: 503 },
      ),
    );
    expect(JSON.parse(body)).toEqual({
      error: "upstream",
      status: 503,
      code: "transcription_disabled",
    });
    expect(body).not.toContain("secret-token");
    expect(
      await captureErrorMessage(new Response(body, { status: 503 }), "Transcription"),
    ).toContain("disabled");
  });
  it.each(["<html>secret</html>", '{"error":{"code":"secret"}}', "x".repeat(5000)])(
    "drops unrecognized, malformed, or oversized failure bodies",
    async (body) => {
      expect(JSON.parse(await upstreamErrorBody(new Response(body, { status: 503 })))).toEqual({
        error: "upstream",
        status: 503,
      });
    },
  );
  it("explains why preview works while processing is unconfigured", async () => {
    const response = Response.json({ error: "not-configured" }, { status: 503 });
    expect(await captureErrorMessage(response, "Video analysis")).toBe(
      "Camera and audio processing are not configured on the server. The local preview still works.",
    );
  });
  it("distinguishes offline processing from model setup and authentication", async () => {
    expect(
      await captureErrorMessage(
        Response.json({ error: "upstream-unreachable" }, { status: 504 }),
        "Transcription",
      ),
    ).toContain("offline");
    expect(
      await captureErrorMessage(
        Response.json({ code: "transcriber_unavailable" }, { status: 503 }),
        "Transcription",
      ),
    ).toContain("speech model");
    expect(await captureErrorMessage(new Response("", { status: 401 }), "Transcription")).toContain(
      "credentials",
    );
  });
});
