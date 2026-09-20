/**
 * Shared prelude for the two event streams this app serves.
 *
 * A proxy between the server and a browser may buffer a response until it has
 * collected enough of it to be worth forwarding, which for an event stream
 * means forever: the first real event can be seconds or minutes away, and the
 * few bytes of a retry hint are not enough to make anything flush. Cloudflare
 * does exactly this, so a dashboard opened through a tunnel sits silent while
 * the same page on localhost updates immediately.
 *
 * Two kilobytes of comment fixes it. A line beginning with ":" is a comment an
 * EventSource ignores, so this is invisible to a subscriber and nothing but
 * volume to the proxy in the middle.
 */

/** Comfortably past the buffer thresholds proxies use in practice. */
const PADDING_BYTES = 2048;

export const SSE_PRELUDE = `:${" ".repeat(PADDING_BYTES)}\n\nretry: 2000\n\n`;

export const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-store, no-transform",
  Connection: "keep-alive",
  // Compressing a stream gives a proxy a reason to hold onto it.
  "Content-Encoding": "identity",
  // Proxies that buffer would defeat the point of streaming these.
  "X-Accel-Buffering": "no",
} as const;
