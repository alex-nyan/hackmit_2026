import { beforeEach, describe, expect, it, vi } from "vitest";

class PreconditionFailed extends Error {}

const put = vi.fn();
const get = vi.fn();
const del = vi.fn();
vi.mock("@vercel/blob", () => ({
  put,
  get,
  del,
  BlobPreconditionFailedError: PreconditionFailed,
}));

const { appendIncident, clearIncidents, readIncidents } = await import("./incidentStore");

import type { IncidentDraft, IncidentEvent } from "./incidents";

const NOW = new Date("2026-09-19T12:00:00.000Z");
/** The retry backoff is real time; tests only care that it retried. */
const noWait = async () => {};

function draft(title: string): IncidentDraft {
  return {
    id: title,
    kind: "scene",
    origin: "operator",
    scenarioAt: null,
    title,
    detail: "",
    source: "test",
    personId: null,
    provenance: null,
    requiresHumanReview: false,
  };
}

function storedLog(events: IncidentEvent[], etag = "etag-1") {
  return {
    stream: new Response(JSON.stringify(events)).body,
    blob: { etag, uploadedAt: NOW },
  };
}

beforeEach(() => {
  put.mockReset().mockResolvedValue({});
  get.mockReset().mockResolvedValue(null);
  del.mockReset().mockResolvedValue(undefined);
});

describe("appending an incident", () => {
  it("starts the log when no workspace has published yet", async () => {
    const event = await appendIncident(draft("first"), NOW, noWait);

    expect(event).toMatchObject({ seq: 1, at: "2026-09-19T12:00:00.000Z", title: "first" });
    // Nothing to match against, so the write must not clobber a log that
    // another instance created a moment ago.
    expect(put.mock.calls[0][2]).toMatchObject({ allowOverwrite: false });
  });

  it("numbers each event after the last one in the log", async () => {
    get.mockResolvedValue(storedLog([{ ...draft("first"), seq: 7, at: "x" } as IncidentEvent]));
    const event = await appendIncident(draft("second"), NOW, noWait);

    expect(event.seq).toBe(8);
    expect(JSON.parse(put.mock.calls[0][1])).toHaveLength(2);
  });

  it("guards the write with the log's ETag, so a simultaneous publish cannot be lost", async () => {
    get.mockResolvedValue(storedLog([], "etag-live"));
    await appendIncident(draft("only"), NOW, noWait);
    expect(put.mock.calls[0][2]).toMatchObject({ ifMatch: "etag-live" });
  });

  it("re-reads and retries when another workspace published first", async () => {
    get
      .mockResolvedValueOnce(storedLog([], "stale"))
      .mockResolvedValueOnce(
        storedLog([{ ...draft("theirs"), seq: 1, at: "x" } as IncidentEvent], "fresh"),
      );
    put.mockRejectedValueOnce(new PreconditionFailed()).mockResolvedValueOnce({});

    const event = await appendIncident(draft("mine"), NOW, noWait);
    // Renumbered behind the event that won the race, not written over it.
    expect(event.seq).toBe(2);
    expect(JSON.parse(put.mock.calls[1][1]).map((e: IncidentEvent) => e.title)).toEqual([
      "theirs",
      "mine",
    ]);
  });

  it("retries a conflict the SDK reports by message rather than by class", async () => {
    // The rejection arrives through the SDK's own retry wrapper, so it is not
    // reliably an instance of the class this module imported.
    get.mockResolvedValueOnce(storedLog([], "stale")).mockResolvedValueOnce(storedLog([], "fresh"));
    put
      .mockRejectedValueOnce(new Error("Vercel Blob: Precondition failed: ETag mismatch."))
      .mockResolvedValueOnce({});

    await expect(appendIncident(draft("mine"), NOW, noWait)).resolves.toMatchObject({ seq: 1 });
    expect(put).toHaveBeenCalledTimes(2);
  });

  it("retries a creation race, where the conflict is an existing blob", async () => {
    put
      .mockRejectedValueOnce(new Error("Vercel Blob: This blob already exists"))
      .mockResolvedValueOnce({});
    await expect(appendIncident(draft("first"), NOW, noWait)).resolves.toMatchObject({ seq: 1 });
    expect(put).toHaveBeenCalledTimes(2);
  });

  it("gives up rather than looping forever on a write that keeps failing", async () => {
    get.mockResolvedValue(storedLog([], "busy"));
    put.mockRejectedValue(new PreconditionFailed());
    await expect(appendIncident(draft("doomed"), NOW, noWait)).rejects.toThrow();
  });

  it("surfaces a genuine write failure instead of retrying it", async () => {
    get.mockResolvedValue(storedLog([], "etag-1"));
    put.mockRejectedValue(new Error("store suspended"));
    await expect(appendIncident(draft("x"), NOW, noWait)).rejects.toThrow("store suspended");
    expect(put).toHaveBeenCalledOnce();
  });

  it("keeps the log bounded", async () => {
    const many = Array.from({ length: 200 }, (_, i) => ({
      ...draft(`e${i}`),
      seq: i + 1,
      at: "x",
    })) as IncidentEvent[];
    get.mockResolvedValue(storedLog(many));
    await appendIncident(draft("newest"), NOW, noWait);

    const written = JSON.parse(put.mock.calls[0][1]) as IncidentEvent[];
    expect(written).toHaveLength(200);
    expect(written.at(-1)?.title).toBe("newest");
    expect(written[0].title).toBe("e1");
  });
});

describe("reading the log", () => {
  it("returns only what a workspace has not already seen", async () => {
    // A stream reads once, so each call needs its own.
    get.mockImplementation(async () =>
      storedLog([
        { ...draft("a"), seq: 1, at: "x" },
        { ...draft("b"), seq: 2, at: "x" },
        { ...draft("c"), seq: 3, at: "x" },
      ] as IncidentEvent[]),
    );
    expect((await readIncidents(1)).map((e) => e.title)).toEqual(["b", "c"]);
    expect((await readIncidents(0)).map((e) => e.title)).toEqual(["a", "b", "c"]);
  });

  it("is empty before anything has been published", async () => {
    expect(await readIncidents(0)).toEqual([]);
  });

  it("treats an unreadable log as empty rather than failing every workspace", async () => {
    get.mockResolvedValue({
      stream: new Response("{not json").body,
      blob: { etag: "e", uploadedAt: NOW },
    });
    expect(await readIncidents(0)).toEqual([]);
  });
});

describe("resetting", () => {
  it("removes the log", async () => {
    await clearIncidents();
    expect(del).toHaveBeenCalledWith("incidents/log.json");
  });

  it("does not fail a reset when there is nothing to remove", async () => {
    del.mockRejectedValue(new Error("not found"));
    await expect(clearIncidents()).resolves.toBeUndefined();
  });
});
