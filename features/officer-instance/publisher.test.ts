import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const fake = vi.hoisted(() => ({
  connect: vi.fn(async () => {}),
  disconnect: vi.fn(async () => {}),
  publish: vi.fn(async () => ({ trackSid: "track-1" })),
  unpublish: vi.fn(async () => {}),
  api: vi.fn(async () => ({ url: "wss://test", token: "test" })),
}));
vi.mock("./client", () => ({ api: fake.api }));
vi.mock("livekit-client", () => ({
  Room: class {
    connect = fake.connect;
    disconnect = fake.disconnect;
    localParticipant = { publishTrack: fake.publish, unpublishTrack: fake.unpublish };
    on() {
      return this;
    }
  },
  RoomEvent: {
    Disconnected: "disconnected",
    Reconnecting: "reconnecting",
    Reconnected: "reconnected",
  },
  Track: { Source: { Camera: "camera", Microphone: "microphone" } },
}));
import { Publisher } from "./publisher";
class FakeTrack extends EventTarget {
  stop = vi.fn();
  constructor(readonly kind = "video") {
    super();
  }
}
class FakeStream {
  constructor(private tracks: FakeTrack[] = []) {}
  getTracks() {
    return this.tracks;
  }
}
const owner = { id: "instance", secret: "owner-secret", createdAt: 1 };
const media = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("MediaStream", FakeStream);
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: media },
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("publisher source ownership", () => {
  it("keeps microphone working when camera permission is denied", async () => {
    const audio = new FakeTrack("audio");
    media.mockImplementation(async (constraints) => {
      if (constraints.video) throw new DOMException("Permission denied", "NotAllowedError");
      return new FakeStream([audio]);
    });
    const p = new Publisher(owner);
    await Promise.all([p.capture("camera", "iphone"), p.capture("audio", "microphone")]);
    expect(p.getSnapshot()).toMatchObject({
      camera: "error",
      audio: "live",
      cameraRef: null,
      audioRef: "track-1",
    });
    expect(media).toHaveBeenCalledWith({ video: { deviceId: { exact: "iphone" } }, audio: false });
    p.stop();
    expect(audio.stop).toHaveBeenCalled();
  });
  it("deduplicates room connection for parallel camera and audio capture", async () => {
    media.mockImplementation(
      async (c) => new FakeStream([new FakeTrack(c.video ? "video" : "audio")]),
    );
    const p = new Publisher(owner);
    await Promise.all([p.capture("camera", null), p.capture("audio", null)]);
    expect(fake.connect).toHaveBeenCalledTimes(1);
    expect(fake.publish).toHaveBeenCalledTimes(2);
    p.stop();
    expect(fake.disconnect).toHaveBeenCalledTimes(1);
  });
  it("stops a permission result that arrives after Stop", async () => {
    let resolve!: (s: FakeStream) => void;
    media.mockReturnValueOnce(
      new Promise((r) => {
        resolve = r;
      }),
    );
    const p = new Publisher(owner);
    const pending = p.capture("camera", null);
    p.stop();
    const late = new FakeTrack();
    resolve(new FakeStream([late]));
    await pending;
    expect(late.stop).toHaveBeenCalled();
    expect(fake.publish).not.toHaveBeenCalled();
    expect(p.getSnapshot().camera).toBe("unavailable");
  });
  it("stops a superseded acquisition without replacing the newer source", async () => {
    let resolve!: (s: FakeStream) => void;
    media.mockReturnValueOnce(
      new Promise((r) => {
        resolve = r;
      }),
    );
    const old = new FakeTrack();
    const newer = new FakeTrack();
    media.mockResolvedValueOnce(new FakeStream([newer]));
    const p = new Publisher(owner);
    const first = p.capture("camera", "old");
    await p.capture("camera", "new");
    resolve(new FakeStream([old]));
    await first;
    expect(old.stop).toHaveBeenCalled();
    expect(newer.stop).not.toHaveBeenCalled();
    expect(fake.publish).toHaveBeenCalledTimes(1);
    p.stop();
  });
  it("reports hot unplugging, permits reconnect, and releases the replacement on Stop", async () => {
    const first = new FakeTrack();
    const next = new FakeTrack();
    media
      .mockResolvedValueOnce(new FakeStream([first]))
      .mockResolvedValueOnce(new FakeStream([next]));
    const p = new Publisher(owner);
    await p.capture("camera", null);
    first.dispatchEvent(new Event("ended"));
    expect(p.getSnapshot()).toMatchObject({ camera: "unavailable", cameraRef: null });
    await p.capture("camera", null);
    expect(p.getSnapshot().camera).toBe("live");
    p.stop();
    expect(next.stop).toHaveBeenCalled();
    expect(p.getSnapshot().stream).toBeNull();
  });
  it("releases acquired capture when the media service fails", async () => {
    const track = new FakeTrack();
    media.mockResolvedValueOnce(new FakeStream([track]));
    fake.api.mockRejectedValueOnce(new Error("LiveKit unavailable"));
    const p = new Publisher(owner);
    await p.capture("camera", null);
    expect(track.stop).toHaveBeenCalled();
    expect(p.getSnapshot()).toMatchObject({ camera: "error", cameraRef: null });
  });
  it("mutes and unmutes source status independently", async () => {
    const track = new FakeTrack();
    media.mockResolvedValueOnce(new FakeStream([track]));
    const p = new Publisher(owner);
    await p.capture("camera", null);
    track.dispatchEvent(new Event("mute"));
    expect(p.getSnapshot().camera).toBe("unavailable");
    track.dispatchEvent(new Event("unmute"));
    expect(p.getSnapshot().camera).toBe("live");
    p.stop();
  });
});
