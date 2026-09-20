import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchLiveTrack, readSettings, type TraccarSettings } from "./traccarSource";

const NOW = new Date("2026-09-19T20:30:00.000Z");

const SETTINGS: TraccarSettings = {
  baseUrl: "http://localhost:8082",
  email: "person@example.com",
  password: "secret",
  deviceIds: [],
};

const UNIT_ONE = { id: 1, name: "Unit 1", status: "online" };
const UNIT_TWO = { id: 2, name: "Unit 2", status: "offline" };

function position(overrides: Record<string, unknown> = {}) {
  return {
    deviceId: 1,
    valid: true,
    latitude: 42.35849,
    longitude: -71.09692,
    accuracy: 9.6,
    speed: 0,
    course: 0,
    fixTime: "2026-09-19T20:29:30.000Z",
    ...overrides,
  };
}

function mockTraccar(devices: unknown, positions: unknown) {
  return vi.fn(async (...args: Parameters<typeof fetch>) => {
    const path = String(args[0]);
    const body = path.includes("/api/devices") ? devices : positions;
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("settings", () => {
  const base = {
    TRACCAR_URL: "http://localhost:8082/",
    TRACCAR_EMAIL: "person@example.com",
    TRACCAR_PASSWORD: "secret",
  };

  it("defaults to every visible device when no ids are given", () => {
    expect(readSettings(base)).toEqual(SETTINGS);
  });

  it("accepts a comma-separated device list", () => {
    expect(readSettings({ ...base, TRACCAR_DEVICE_IDS: "1, 2,3" })?.deviceIds).toEqual([1, 2, 3]);
  });

  it("still honours the superseded single-device name", () => {
    expect(readSettings({ ...base, TRACCAR_DEVICE_ID: "4" })?.deviceIds).toEqual([4]);
  });

  it("drops entries that are not device ids", () => {
    expect(readSettings({ ...base, TRACCAR_DEVICE_IDS: "1,abc,0,-2,3" })?.deviceIds).toEqual([
      1, 3,
    ]);
  });

  it("treats missing credentials as unconfigured", () => {
    expect(readSettings({ ...base, TRACCAR_PASSWORD: undefined })).toBeNull();
    expect(readSettings({ ...base, TRACCAR_URL: "  " })).toBeNull();
    expect(readSettings({})).toBeNull();
  });
});

describe("fetching the fleet", () => {
  it("authenticates with Basic auth and does not cache", async () => {
    const fetchMock = mockTraccar([UNIT_ONE], [position()]);
    vi.stubGlobal("fetch", fetchMock);

    await fetchLiveTrack(SETTINGS, NOW);

    const [, init] = fetchMock.mock.calls[0];
    const header = init?.headers as Record<string, string>;
    expect(header.Authorization).toBe(
      `Basic ${Buffer.from("person@example.com:secret").toString("base64")}`,
    );
    expect(init?.cache).toBe("no-store");
  });

  it("uses two requests no matter how many devices there are", async () => {
    const fetchMock = mockTraccar(
      [UNIT_ONE, UNIT_TWO, { id: 3, name: "Unit 3", status: "online" }],
      [position(), position({ deviceId: 2 }), position({ deviceId: 3 })],
    );
    vi.stubGlobal("fetch", fetchMock);

    await fetchLiveTrack(SETTINGS, NOW);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns every device with its own newest fix", async () => {
    vi.stubGlobal(
      "fetch",
      mockTraccar(
        [UNIT_ONE, UNIT_TWO],
        [
          position({ deviceId: 1, fixTime: "2026-09-19T20:00:00.000Z" }),
          position({ deviceId: 1, fixTime: "2026-09-19T20:29:30.000Z" }),
          position({ deviceId: 2, latitude: 42.37, fixTime: "2026-09-19T20:29:00.000Z" }),
        ],
      ),
    );

    const payload = await fetchLiveTrack(SETTINGS, NOW);
    expect(payload.state).toBe("tracking");
    if (payload.state !== "tracking") return;

    expect(payload.devices).toHaveLength(2);
    const one = payload.devices.find((device) => device.id === "1")!;
    const two = payload.devices.find((device) => device.id === "2")!;
    expect(one.fix?.fixedAt).toBe("2026-09-19T20:29:30.000Z");
    expect(one.online).toBe(true);
    expect(two.fix?.latitude).toBe(42.37);
    expect(two.online).toBe(false);
  });

  it("orders the roster freshest first, with fixless units last", async () => {
    vi.stubGlobal(
      "fetch",
      mockTraccar(
        [
          { id: 1, name: "Stale", status: "online" },
          { id: 2, name: "Freshest", status: "online" },
          { id: 3, name: "Never reported", status: "offline" },
        ],
        [
          position({ deviceId: 1, fixTime: "2026-09-19T20:10:00.000Z" }),
          position({ deviceId: 2, fixTime: "2026-09-19T20:29:50.000Z" }),
        ],
      ),
    );

    const payload = await fetchLiveTrack(SETTINGS, NOW);
    if (payload.state !== "tracking") throw new Error("expected tracking");
    expect(payload.devices.map((device) => device.name)).toEqual([
      "Freshest",
      "Stale",
      "Never reported",
    ]);
  });

  it("keeps a device with no usable fix rather than hiding it", async () => {
    vi.stubGlobal("fetch", mockTraccar([UNIT_ONE], [position({ valid: false })]));
    const payload = await fetchLiveTrack(SETTINGS, NOW);
    if (payload.state !== "tracking") throw new Error("expected tracking");
    expect(payload.devices).toEqual([{ id: "1", name: "Unit 1", online: true, fix: null }]);
  });

  it("restricts the fleet when device ids are configured", async () => {
    vi.stubGlobal(
      "fetch",
      mockTraccar([UNIT_ONE, UNIT_TWO], [position(), position({ deviceId: 2 })]),
    );
    const payload = await fetchLiveTrack({ ...SETTINGS, deviceIds: [2] }, NOW);
    if (payload.state !== "tracking") throw new Error("expected tracking");
    expect(payload.devices.map((device) => device.id)).toEqual(["2"]);
  });

  it("reports no devices instead of an empty map", async () => {
    vi.stubGlobal("fetch", mockTraccar([], []));
    expect(await fetchLiveTrack(SETTINGS, NOW)).toEqual({ state: "no-devices" });

    vi.stubGlobal("fetch", mockTraccar([UNIT_ONE], []));
    expect(await fetchLiveTrack({ ...SETTINGS, deviceIds: [99] }, NOW)).toEqual({
      state: "no-devices",
    });
  });

  it("separates reachability from fix freshness", async () => {
    // Traccar still calls the device online while the last fix is 25 minutes old.
    vi.stubGlobal(
      "fetch",
      mockTraccar([UNIT_ONE], [position({ fixTime: "2026-09-19T20:05:00.000Z" })]),
    );
    const payload = await fetchLiveTrack(SETTINGS, NOW);
    if (payload.state !== "tracking") throw new Error("expected tracking");
    expect(payload.devices[0].online).toBe(true);
    expect(payload.devices[0].fix?.freshness).toBe("lost");
  });

  it("raises a status-only error that cannot leak the request", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("bad credentials for person@example.com", { status: 401 })),
    );
    const error = await fetchLiveTrack(SETTINGS, NOW).catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message;
    expect(message).toBe("Traccar responded 401");
    // The upstream body echoed the account; it must not reach the caller.
    expect(message).not.toContain("person@example.com");
    expect(message).not.toContain("secret");
  });
});
