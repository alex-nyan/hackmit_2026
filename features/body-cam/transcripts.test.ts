import { beforeEach, describe, expect, it, vi } from "vitest";

const put = vi.fn();
const get = vi.fn();
vi.mock("@vercel/blob", () => ({ put, get }));

const { TRANSCRIPT_TTL_MS, parseTranscript, publishTranscript, readTranscript } =
  await import("./transcripts");

const NOW = Date.parse("2026-09-19T12:00:00.000Z");

function stored(record: unknown) {
  return { stream: new Response(JSON.stringify(record)).body, blob: { etag: "e" } };
}

beforeEach(() => {
  put.mockReset().mockResolvedValue({});
  get.mockReset().mockResolvedValue(null);
});

describe("reading a transcription response", () => {
  it("takes the text when there is any", () => {
    expect(parseTranscript({ text: "  shots fired  " })).toBe("shots fired");
  });

  it("treats silence as nothing to show", () => {
    expect(parseTranscript({ text: "   " })).toBeNull();
    expect(parseTranscript({})).toBeNull();
    expect(parseTranscript(null)).toBeNull();
    expect(parseTranscript("words")).toBeNull();
  });

  it("bounds the length, so one clip cannot fill a tile", () => {
    expect(parseTranscript({ text: "x".repeat(1000) })?.length).toBe(400);
  });
});

describe("publishing", () => {
  it("keeps one transcript per officer, overwritten in place", async () => {
    await publishTranscript("unit-02", "shots fired", new Date(NOW));
    const [pathname, body, options] = put.mock.calls[0];
    expect(pathname).toBe("transcripts/unit-02.json");
    expect(JSON.parse(body)).toEqual({
      sourceId: "unit-02",
      text: "shots fired",
      at: "2026-09-19T12:00:00.000Z",
    });
    expect(options).toMatchObject({ access: "private", allowOverwrite: true });
  });

  it("refuses a source id the rest of the pipeline would reject", async () => {
    await publishTranscript("unit 02", "nope");
    expect(put).not.toHaveBeenCalled();
  });
});

describe("reading", () => {
  it("returns a recent transcript", async () => {
    get.mockResolvedValue(
      stored({ sourceId: "unit-01", text: "shots fired", at: new Date(NOW).toISOString() }),
    );
    expect((await readTranscript("unit-01", NOW))?.text).toBe("shots fired");
  });

  it("drops one old enough to misdescribe the tile above it", async () => {
    get.mockResolvedValue(
      stored({
        sourceId: "unit-01",
        text: "stale",
        at: new Date(NOW - TRANSCRIPT_TTL_MS - 1).toISOString(),
      }),
    );
    expect(await readTranscript("unit-01", NOW)).toBeNull();
  });

  it("is nothing when the officer has never been heard", async () => {
    expect(await readTranscript("unit-09", NOW)).toBeNull();
  });

  it("treats an unreadable record as nothing rather than failing the wall", async () => {
    get.mockResolvedValue({ stream: new Response("{not json").body, blob: { etag: "e" } });
    expect(await readTranscript("unit-01", NOW)).toBeNull();

    get.mockResolvedValue(stored({ sourceId: "unit-01" }));
    expect(await readTranscript("unit-01", NOW)).toBeNull();
  });
});
