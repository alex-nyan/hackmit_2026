import { beforeEach, describe, expect, it, vi } from "vitest";

const put = vi.fn();
const get = vi.fn();
const del = vi.fn();

class BlobPreconditionFailedError extends Error {
  constructor() {
    super("precondition failed");
    this.name = "BlobPreconditionFailedError";
  }
}

vi.mock("@vercel/blob", () => ({ put, get, del, BlobPreconditionFailedError }));

const {
  clearPositions,
  isPositionStoreConfigured,
  listPublishedDevices,
  publishPosition,
  removePosition,
} = await import("./positionStore");
const { POSITION_PATH } = await import("./devicePosition");
import type { PositionSubmission, StoredPosition } from "./devicePosition";

const NOW = new Date("2026-09-20T12:00:00.000Z");
const noSleep = async () => {};

function submission(overrides: Partial<PositionSubmission> = {}): PositionSubmission {
  return {
    sourceId: "unit-01",
    name: "Unit 01",
    longitude: -71.092,
    latitude: 42.36,
    accuracyMeters: 12,
    speedKmh: 0,
    headingDegrees: null,
    fixedAt: "2026-09-20T11:59:58.000Z",
    ...overrides,
  };
}

/**
 * A body stream can only be read once, so each read gets a fresh one. The real
 * client returns a new response per call; reusing one here would make a retry
 * look at an empty store and mask whether it re-read at all.
 */
function holds(positions: StoredPosition[], etag = "etag-1") {
  get.mockImplementation(async () => ({
    stream: new Response(JSON.stringify(positions)).body,
    blob: { etag, uploadedAt: NOW },
  }));
}

function written(call = 0): StoredPosition[] {
  return JSON.parse(put.mock.calls[call][1] as string) as StoredPosition[];
}

beforeEach(() => {
  put.mockReset().mockResolvedValue({});
  get.mockReset().mockResolvedValue(null);
  del.mockReset().mockResolvedValue(undefined);
});

describe("publishing a position", () => {
  it("writes one shared object rather than one per unit", async () => {
    await publishPosition(submission(), NOW, noSleep);

    expect(put).toHaveBeenCalledOnce();
    const [pathname, , options] = put.mock.calls[0];
    expect(pathname).toBe(POSITION_PATH);
    expect(options).toMatchObject({
      access: "private",
      contentType: "application/json",
      addRandomSuffix: false,
    });
  });

  it("keeps the store private, so a position never becomes a durable public link", async () => {
    await publishPosition(submission(), NOW, noSleep);
    expect(put.mock.calls[0][2]).toMatchObject({ access: "private" });
  });

  it("stamps the server clock on the fix", async () => {
    const stored = await publishPosition(submission(), NOW, noSleep);
    expect(stored.publishedAt).toBe("2026-09-20T12:00:00.000Z");
  });

  it("refuses to overwrite a store it has not read", async () => {
    await publishPosition(submission(), NOW, noSleep);
    expect(put.mock.calls[0][2]).toMatchObject({ allowOverwrite: false });
  });

  it("guards an append with the ETag it read", async () => {
    holds([]);
    await publishPosition(submission(), NOW, noSleep);
    expect(put.mock.calls[0][2]).toMatchObject({ ifMatch: "etag-1" });
  });

  it("leaves another unit's fix in place", async () => {
    holds([
      {
        ...submission({ sourceId: "unit-02", name: "Unit 02" }),
        publishedAt: NOW.toISOString(),
      },
    ]);

    await publishPosition(submission(), NOW, noSleep);
    expect(written().map((position) => position.sourceId)).toEqual(["unit-01", "unit-02"]);
  });

  it("replaces this unit's own previous fix rather than keeping a trail", async () => {
    holds([{ ...submission({ latitude: 42.1 }), publishedAt: NOW.toISOString() }]);

    await publishPosition(submission({ latitude: 42.9 }), NOW, noSleep);
    const positions = written();
    expect(positions).toHaveLength(1);
    expect(positions[0].latitude).toBe(42.9);
  });

  it("retries against the store as it now stands when another phone wins the race", async () => {
    holds([]);
    put.mockRejectedValueOnce(new BlobPreconditionFailedError()).mockResolvedValue({});

    await publishPosition(submission(), NOW, noSleep);
    expect(put).toHaveBeenCalledTimes(2);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("gives up rather than looping forever on a losing race", async () => {
    holds([]);
    put.mockRejectedValue(new BlobPreconditionFailedError());
    await expect(publishPosition(submission(), NOW, noSleep)).rejects.toThrow();
  });

  it("hands a real failure to the caller instead of retrying it", async () => {
    holds([]);
    put.mockRejectedValue(new Error("network down"));
    await expect(publishPosition(submission(), NOW, noSleep)).rejects.toThrow("network down");
    expect(put).toHaveBeenCalledOnce();
  });

  it("replaces an unreadable store rather than letting it block every publish", async () => {
    get.mockResolvedValue({
      stream: new Response("{not json").body,
      blob: { etag: "etag-9", uploadedAt: NOW },
    });

    await publishPosition(submission(), NOW, noSleep);
    expect(written()).toHaveLength(1);
  });
});

describe("reading the roster", () => {
  it("returns the view model the map already draws", async () => {
    holds([{ ...submission(), publishedAt: NOW.toISOString() }]);

    const { devices } = await listPublishedDevices(NOW.getTime());
    expect(devices).toEqual([
      {
        id: "unit-01",
        name: "Unit 01",
        online: true,
        fix: {
          longitude: -71.092,
          latitude: 42.36,
          accuracyMeters: 12,
          speedKmh: 0,
          headingDegrees: null,
          fixedAt: "2026-09-20T11:59:58.000Z",
          ageSeconds: 0,
          freshness: "live",
        },
      },
    ]);
  });

  it("is empty rather than failing when nobody has published", async () => {
    expect((await listPublishedDevices(NOW.getTime())).devices).toEqual([]);
  });

  it("leaves out a unit whose fix is old enough to be a previous demo", async () => {
    holds([
      { ...submission(), publishedAt: NOW.toISOString() },
      {
        ...submission({ sourceId: "unit-02" }),
        publishedAt: new Date(NOW.getTime() - 3_600_000).toISOString(),
      },
    ]);

    const { devices } = await listPublishedDevices(NOW.getTime());
    expect(devices.map((device) => device.id)).toEqual(["unit-01"]);
  });
});

describe("resetting", () => {
  it("clears every published position at once", async () => {
    await clearPositions();
    expect(del).toHaveBeenCalledWith(POSITION_PATH);
  });

  it("treats an already-empty store as reset rather than an error", async () => {
    del.mockRejectedValue(new Error("not found"));
    await expect(clearPositions()).resolves.toBeUndefined();
  });
});

describe("knowing whether there is anywhere to publish", () => {
  it("needs a blob token before a phone is told tracking works", () => {
    expect(isPositionStoreConfigured({})).toBe(false);
    expect(isPositionStoreConfigured({ BLOB_READ_WRITE_TOKEN: "   " })).toBe(false);
    expect(isPositionStoreConfigured({ BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_x" })).toBe(true);
  });
});

describe("withdrawing one unit", () => {
  function stored(sourceId: string, at = "2026-09-20T11:59:58.000Z"): StoredPosition {
    return { ...submission({ sourceId }), publishedAt: at };
  }

  it("removes the unit that left and leaves everyone else on the map", async () => {
    holds([stored("unit-01"), stored("unit-02")]);

    await expect(removePosition("unit-01", NOW, noSleep)).resolves.toBe(true);
    expect(written().map((position) => position.sourceId)).toEqual(["unit-02"]);
  });

  it("does not write when the unit is not there to remove", async () => {
    holds([stored("unit-02")]);

    await expect(removePosition("unit-01", NOW, noSleep)).resolves.toBe(false);
    expect(put).not.toHaveBeenCalled();
  });

  it("does not write against an empty store", async () => {
    await expect(removePosition("unit-01", NOW, noSleep)).resolves.toBe(false);
    expect(put).not.toHaveBeenCalled();
  });

  it("guards the write with the etag it read, like every other write does", async () => {
    holds([stored("unit-01")], "etag-9");

    await removePosition("unit-01", NOW, noSleep);
    expect(put.mock.calls[0][2]).toMatchObject({ ifMatch: "etag-9" });
  });

  it("writes an empty store when the last unit leaves", async () => {
    holds([stored("unit-01")]);

    await removePosition("unit-01", NOW, noSleep);
    expect(written()).toEqual([]);
  });

  it("retries against the store as it now stands when it loses a race", async () => {
    holds([stored("unit-01"), stored("unit-02")]);
    put.mockRejectedValueOnce(new BlobPreconditionFailedError()).mockResolvedValue({});

    await expect(removePosition("unit-01", NOW, noSleep)).resolves.toBe(true);
    expect(put).toHaveBeenCalledTimes(2);
    expect(written(1).map((position) => position.sourceId)).toEqual(["unit-02"]);
  });

  it("gives a failure that is not a lost race back to the caller", async () => {
    holds([stored("unit-01")]);
    put.mockRejectedValue(new Error("blob store unreachable"));

    await expect(removePosition("unit-01", NOW, noSleep)).rejects.toThrow("unreachable");
  });

  it("drops units that had already expired while it is writing anyway", async () => {
    // Two hours old, well past the point where a fix describes anywhere.
    holds([stored("unit-01"), stored("unit-09", "2026-09-20T10:00:00.000Z")]);

    await removePosition("unit-01", NOW, noSleep);
    expect(written()).toEqual([]);
  });
});
