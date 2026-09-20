type BodyReadResult = { ok: true; body: string } | { ok: false; status: 400 | 413; error: string };

/** Bound raw request or response bytes before decoding or retaining the full body. */
export async function readFrameBody(
  request: Pick<Request, "headers" | "body">,
  maxBytes: number,
): Promise<BodyReadResult> {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    if (!/^\d+$/.test(contentLength)) {
      return { ok: false, status: 400, error: "invalid-content-length" };
    }
    if (Number(contentLength) > maxBytes) {
      return { ok: false, status: 413, error: "frame-too-large" };
    }
  }

  if (!request.body) return { ok: true, body: "" };

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  const parts: string[] = [];
  let bytesRead = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytesRead += value.byteLength;
      if (bytesRead > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, status: 413, error: "frame-too-large" };
      }
      parts.push(decoder.decode(value, { stream: true }));
    }
    parts.push(decoder.decode());
    return { ok: true, body: parts.join("") };
  } catch {
    return { ok: false, status: 400, error: "invalid-request-body" };
  } finally {
    reader.releaseLock();
  }
}
