// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const fake = vi.hoisted(() => ({
  value: null as string | null,
  deleteRoom: vi.fn(async () => {}),
  getGps: vi.fn(),
}));
vi.mock("./store", () => ({
  instanceStore: () => ({
    read: async () => fake.value,
    compareAndSet: async (old: string | null, next: string) => {
      if (old !== fake.value) return false;
      fake.value = next;
      return true;
    },
  }),
  transact: async (...args: unknown[]) => {
    const real = await vi.importActual<typeof import("./store")>("./store");
    return real.transact(...(args as Parameters<typeof real.transact>));
  },
}));
vi.mock("livekit-server-sdk", async (importOriginal) => ({
  ...(await importOriginal<typeof import("livekit-server-sdk")>()),
  RoomServiceClient: class {
    listRooms = async () => [{}];
    deleteRoom = fake.deleteRoom;
  },
}));
vi.mock("../live-track/traccarSource", () => ({
  readSettings: () => ({}),
  fetchLiveTrack: fake.getGps,
}));
import { body, command, create, mediaToken, parseCommand, snapshot } from "./server";
import { POST } from "../../app/api/instances/command/route";
import { POST as tokenRoute } from "../../app/api/instances/token/route";

beforeEach(() => {
  fake.value = null;
  fake.deleteRoom.mockClear();
  vi.stubEnv("LIVEKIT_URL", "wss://example.livekit.cloud");
  vi.stubEnv("LIVEKIT_API_KEY", "test-key");
  vi.stubEnv("LIVEKIT_API_SECRET", "test-only-secret-for-signing-1234567890");
});
afterEach(() => vi.unstubAllEnvs());
const req = (data: unknown, secret?: string) =>
  new Request("https://example.test/api/instances/command", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(secret ? { "x-publisher-secret": secret } : {}),
    },
    body: JSON.stringify(data),
  });

describe("instance APIs across independent callers", () => {
  it("serializes duplicate creates and requires explicit replacement", async () => {
    const attempts = await Promise.allSettled([create("Alex"), create("Blair")]);
    expect(attempts.filter((a) => a.status === "fulfilled")).toHaveLength(1);
    const previous = (await snapshot()).instance!;
    await expect(create("New")).rejects.toMatchObject({ status: 409 });
    await expect(create("", previous.id)).rejects.toThrow();
    expect((await snapshot()).instance?.lifecycle).toBe("ready");
    const replacement = await create("New", previous.id);
    expect(replacement.instance.id).not.toBe(previous.id);
    expect(fake.deleteRoom).toHaveBeenCalledWith(previous.media.room);
    await expect(create("Third", previous.id)).rejects.toMatchObject({ status: 409 });
  });
  it("does not expose the publisher credential to late joiners", async () => {
    const created = await create("Alex");
    const lateJoin = await snapshot();
    expect(lateJoin.instance?.id).toBe(created.instance.id);
    expect(JSON.stringify(lateJoin)).not.toContain(created.ownership.secret);
    expect(JSON.stringify(lateJoin)).not.toContain("ownerHash");
  });
  it("rejects wrong owners and delayed writes from a replaced publisher", async () => {
    const first = await create("Alex");
    const response = await POST(
      req({ id: first.instance.id, type: "start", sequence: 1 }, "wrong"),
    );
    expect(response.status).toBe(409);
    await create("New", first.instance.id);
    await expect(
      command(first.instance.id, { type: "heartbeat" }, first.ownership.secret, 2),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("only grants publication to the owner and scopes every token to its room", async () => {
    const first = await create("Alex");
    await command(first.instance.id, { type: "start" }, first.ownership.secret, 1);
    await expect(mediaToken(first.instance.id, "publisher", "wrong")).rejects.toThrow();
    for (const role of ["publisher", "viewer"] as const) {
      const credential = await mediaToken(first.instance.id, role, first.ownership.secret);
      const jwt = JSON.parse(Buffer.from(credential.token.split(".")[1], "base64url").toString());
      expect(jwt.video.room).toBe(first.instance.media.room);
      expect(jwt.video.canPublish).toBe(role === "publisher");
      expect(jwt.video.canPublishData).toBe(false);
      expect(jwt.exp - jwt.nbf).toBeLessThanOrEqual(60);
    }
    const response = await tokenRoute(req({ id: first.instance.id, role: "admin" }));
    expect(response.status).toBe(400);
  });
  it("gates Hospital until requested, cancels access, and does not grant clearance", async () => {
    const first = await create("Alex");
    await command(first.instance.id, { type: "start" }, first.ownership.secret, 1);
    expect((await snapshot(true)).instance).toBeNull();
    await expect(mediaToken(first.instance.id, "hospital", "")).rejects.toMatchObject({
      status: 403,
    });
    await command(first.instance.id, { type: "assignment", requested: true }, "");
    expect((await snapshot(true)).instance?.scene.status).toBe("unknown");
    expect((await mediaToken(first.instance.id, "hospital", "")).token).toBeTruthy();
    await command(first.instance.id, { type: "assignment", requested: false }, "");
    expect((await snapshot(true)).instance).toBeNull();
  });
  it("Stop is retryable, revokes the room, and clears Hospital", async () => {
    const first = await create("Alex");
    await command(first.instance.id, { type: "assignment", requested: true }, "");
    await command(first.instance.id, { type: "stop" }, first.ownership.secret, 1);
    await command(first.instance.id, { type: "stop" }, first.ownership.secret, 2);
    expect(fake.deleteRoom).toHaveBeenCalledTimes(2);
    expect((await snapshot(true)).instance).toBeNull();
    await expect(
      mediaToken(first.instance.id, "publisher", first.ownership.secret),
    ).rejects.toThrow();
  });
  it("does not create a replacement if revoking the previous room fails", async () => {
    const first = await create("Alex");
    fake.deleteRoom.mockRejectedValueOnce(new Error("network"));
    await expect(create("New", first.instance.id)).rejects.toThrow();
    expect((await snapshot()).instance).toMatchObject({
      id: first.instance.id,
      lifecycle: "ended",
    });
  });
  it("fetches only selected Traccar fixes and publishes source failure independently", async () => {
    const first = await create("Alex");
    await command(first.instance.id, { type: "start" }, first.ownership.secret, 1);
    fake.getGps.mockResolvedValueOnce({
      state: "tracking",
      devices: [
        { id: "9", name: "Other", fix: null },
        { id: "7", name: "Selected", fix: null },
      ],
    });
    const result = await command(
      first.instance.id,
      { type: "gps", deviceId: "7" },
      first.ownership.secret,
      2,
    );
    expect(result.instance?.gps?.id).toBe("7");
    expect(result.instance?.sources.gps.state).toBe("unavailable");
  });
  it("rejects cross-origin writes, malformed telemetry and oversized requests", async () => {
    await expect(
      body(
        new Request("https://example.test/api/instances", {
          method: "POST",
          headers: { Origin: "https://elsewhere.test", "Content-Type": "application/json" },
          body: "{}",
        }),
      ),
    ).rejects.toMatchObject({ status: 403 });
    await expect(body(req({ huge: "a".repeat(9000) }))).rejects.toMatchObject({ status: 413 });
    expect(() => parseCommand({ type: "telemetry", sources: { gps: "live" } })).toThrow();
    expect(() =>
      parseCommand({ type: "telemetry", heart: { bpm: 1000, receivedAt: 1 } }),
    ).toThrow();
    expect(() => parseCommand({ type: "gps", deviceId: "phone-browser" })).toThrow();
    expect(parseCommand({ type: "gps", deviceId: "7" })).toEqual({ type: "gps", deviceId: "7" });
  });
});
