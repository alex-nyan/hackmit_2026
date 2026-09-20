import { beforeEach, describe, expect, it, vi } from "vitest";

const put = vi.fn();
const list = vi.fn();
const get = vi.fn();
const del = vi.fn();
vi.mock("@vercel/blob", () => ({ put, list, get, del }));

const {
  HISTORY_WINDOW_MS,
  MAX_SOURCES,
  STALE_AFTER_MS,
  clearWall,
  listFrames,
  listHistory,
  publishFrame,
  readFrame,
  readFrameAt,
} = await import("./store");

const JPEG = "/9j/4AAQSkZJRg==";
const NOW = Date.parse("2026-09-19T12:00:00.000Z");

function blob(sourceId: string, ageMs = 0, size = 344) {
  return {
    pathname: `frames/${sourceId}.jpg`,
    url: `https://blob.example/${sourceId}`,
    size,
    uploadedAt: new Date(NOW - ageMs),
  };
}

beforeEach(() => {
  put.mockReset().mockResolvedValue({});
  list.mockReset().mockResolvedValue({ blobs: [] });
  get.mockReset().mockResolvedValue(null);
  del.mockReset().mockResolvedValue(undefined);
});

describe("publishing a frame", () => {
  it("writes one object per officer, overwriting the previous frame", async () => {
    const summary = await publishFrame(
      { sourceId: "unit-02", base64: JPEG, capturedAt: null },
      new Date(NOW),
    );

    // Two objects: the wall's latest, and the same frame in the archive.
    expect(put).toHaveBeenCalledTimes(2);
    const written = put.mock.calls.map(([pathname]) => pathname).sort();
    expect(written).toEqual(["frames/unit-02.jpg", "history/unit-02/1789819200000.jpg"]);
    const [pathname, , options] = put.mock.calls[0];
    expect(pathname).toBe("frames/unit-02.jpg");
    // A random suffix would leave every old frame behind it in the store.
    expect(options).toMatchObject({
      access: "private",
      contentType: "image/jpeg",
      addRandomSuffix: false,
      allowOverwrite: true,
    });
    expect(summary).toEqual({
      sourceId: "unit-02",
      at: "2026-09-19T12:00:00.000Z",
      bytes: 10,
    });
  });

  it("keeps the store private, so a frame never becomes a durable public link", async () => {
    await publishFrame({ sourceId: "unit-01", base64: JPEG, capturedAt: null });
    expect(put.mock.calls[0][2]).toMatchObject({ access: "private" });
  });
});

describe("listing the wall", () => {
  it("names every officer still publishing, in a stable order", async () => {
    list.mockResolvedValue({ blobs: [blob("unit-02"), blob("unit-01")] });
    expect((await listFrames(NOW)).map((f) => f.sourceId)).toEqual(["unit-01", "unit-02"]);
  });

  it("drops a source that has gone quiet rather than showing its last frame", async () => {
    list.mockResolvedValue({
      blobs: [blob("unit-01", STALE_AFTER_MS - 1), blob("unit-02", STALE_AFTER_MS + 1)],
    });
    expect((await listFrames(NOW)).map((f) => f.sourceId)).toEqual(["unit-01"]);
  });

  it("ignores objects that are not an officer's frame", async () => {
    list.mockResolvedValue({
      blobs: [blob("unit-01"), { ...blob("x"), pathname: "notes/readme.txt" }],
    });
    expect((await listFrames(NOW)).map((f) => f.sourceId)).toEqual(["unit-01"]);
  });

  it("bounds what one wall will render", async () => {
    list.mockResolvedValue({
      blobs: Array.from({ length: MAX_SOURCES + 5 }, (_, i) =>
        blob(`unit-${String(i).padStart(2, "0")}`),
      ),
    });
    expect(await listFrames(NOW)).toHaveLength(MAX_SOURCES);
  });

  it("reports the decoded size the store recorded", async () => {
    list.mockResolvedValue({ blobs: [blob("unit-01", 0, 20_481)] });
    expect((await listFrames(NOW))[0].bytes).toBe(20_481);
  });
});

describe("reading one officer's frame", () => {
  it("streams the bytes rather than handing out a URL", async () => {
    const stream = {} as ReadableStream;
    get.mockResolvedValue({ stream, blob: { uploadedAt: new Date(NOW) } });

    expect(await readFrame("unit-01", NOW)).toBe(stream);
    expect(get).toHaveBeenCalledWith("frames/unit-01.jpg", {
      access: "private",
      // The pathname never changes, so a cached copy would be the previous view.
      useCache: false,
    });
  });

  it("is a miss, not an old picture, once the frame goes stale", async () => {
    get.mockResolvedValue({
      stream: {} as ReadableStream,
      blob: { uploadedAt: new Date(NOW - STALE_AFTER_MS - 1) },
    });
    expect(await readFrame("unit-01", NOW)).toBeNull();
  });

  it("is a miss when the officer has never published", async () => {
    get.mockResolvedValue(null);
    expect(await readFrame("unit-09", NOW)).toBeNull();
  });
});

describe("resetting the wall", () => {
  it("removes the latest frames and the archive together", async () => {
    list.mockResolvedValue({ blobs: [blob("unit-01"), blob("unit-02")] });
    await clearWall();
    // Both prefixes are swept, so review cannot outlive a reset.
    const prefixes = list.mock.calls.map(([options]) => options.prefix).sort();
    expect(prefixes).toEqual(["frames/", "history/"]);
    expect(del.mock.calls[0][0]).toHaveLength(4);
  });

  it("does nothing when the wall is already empty", async () => {
    await clearWall();
    expect(del).not.toHaveBeenCalled();
  });
});

describe("reviewing an officer's recent footage", () => {
  it("lists the moments inside the review window, oldest first", async () => {
    list.mockResolvedValue({
      blobs: [
        { ...blob("x"), pathname: `history/unit-01/${NOW}.jpg` },
        { ...blob("x"), pathname: `history/unit-01/${NOW - 60_000}.jpg` },
      ],
    });
    expect(await listHistory("unit-01", NOW)).toEqual([NOW - 60_000, NOW]);
  });

  it("leaves out anything older than the window", async () => {
    list.mockResolvedValue({
      blobs: [
        { ...blob("x"), pathname: `history/unit-01/${NOW - HISTORY_WINDOW_MS - 1}.jpg` },
        { ...blob("x"), pathname: `history/unit-01/${NOW}.jpg` },
      ],
    });
    expect(await listHistory("unit-01", NOW)).toEqual([NOW]);
  });

  it("serves one archived frame by its moment", async () => {
    const stream = {} as ReadableStream;
    get.mockResolvedValue({ stream, blob: { uploadedAt: new Date(NOW) } });
    expect(await readFrameAt("unit-01", NOW)).toBe(stream);
    expect(get).toHaveBeenCalledWith(`history/unit-01/${NOW}.jpg`, {
      access: "private",
      useCache: false,
    });
  });

  it("is a miss when that moment was never published", async () => {
    get.mockResolvedValue(null);
    expect(await readFrameAt("unit-01", NOW)).toBeNull();
  });
});
