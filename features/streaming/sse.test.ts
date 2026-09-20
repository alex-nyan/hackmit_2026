import { describe, expect, it } from "vitest";

import { SSE_HEADERS, SSE_PRELUDE } from "./sse";

describe("the event stream prelude", () => {
  it("is large enough to push a buffering proxy into forwarding", () => {
    expect(SSE_PRELUDE.length).toBeGreaterThan(2000);
  });

  it("pads with a comment, which a subscriber ignores", () => {
    const [padding] = SSE_PRELUDE.split("\n");
    expect(padding.startsWith(":")).toBe(true);
    expect(padding.slice(1).trim()).toBe("");
  });

  it("still carries the retry hint a reconnecting subscriber needs", () => {
    expect(SSE_PRELUDE).toContain("retry: 2000\n\n");
  });

  it("asks every hop not to cache, transform or compress the stream", () => {
    expect(SSE_HEADERS["Cache-Control"]).toContain("no-transform");
    expect(SSE_HEADERS["Content-Encoding"]).toBe("identity");
    expect(SSE_HEADERS["X-Accel-Buffering"]).toBe("no");
  });
});
