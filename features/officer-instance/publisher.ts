import { Room, RoomEvent, Track } from "livekit-client";
import { api } from "./client";
import type { Ownership, SourceState } from "./types";

export interface PublisherState {
  stream: MediaStream | null;
  camera: SourceState;
  audio: SourceState;
  cameraRef: string | null;
  audioRef: string | null;
  error: string | null;
}
const EMPTY: PublisherState = {
  stream: null,
  camera: "unavailable",
  audio: "unavailable",
  cameraRef: null,
  audioRef: null,
  error: null,
};
/** Sole owner of capture tracks; generation checks close permission results arriving after Stop. */
export class Publisher {
  private state: PublisherState = EMPTY;
  private listeners = new Set<() => void>();
  private room: Room | null = null;
  private pending: Promise<Room> | null = null;
  private generation = 0;
  private attempts = { camera: 0, audio: 0 };
  private tracks = new Map<"camera" | "audio", MediaStreamTrack>();
  constructor(private owner: Ownership) {}
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  getSnapshot = () => this.state;
  getServerSnapshot = () => EMPTY;
  private update(patch: Partial<PublisherState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((fn) => fn());
  }
  private async connectRoom(): Promise<Room> {
    if (this.room) return this.room;
    if (this.pending) return this.pending;
    const generation = this.generation;
    const pending = (async () => {
      const credentials = await api<{ url: string; token: string }>(
        "/token",
        { id: this.owner.id, role: "publisher" },
        this.owner.secret,
      );
      if (generation !== this.generation) throw new Error("Broadcast stopped.");
      const room = new Room({ disconnectOnPageLeave: true });
      try {
        await room.connect(credentials.url, credentials.token, { autoSubscribe: false });
        if (generation !== this.generation) {
          await room.disconnect();
          throw new Error("Broadcast stopped.");
        }
        this.room = room;
        room.on(RoomEvent.Reconnecting, () => {
          if (this.room === room) this.update({ camera: "connecting", audio: "connecting" });
        });
        room.on(RoomEvent.Reconnected, () => {
          if (this.room === room)
            this.update({
              camera: this.tracks.has("camera") ? "live" : "unavailable",
              audio: this.tracks.has("audio") ? "live" : "unavailable",
            });
        });
        room.on(RoomEvent.Disconnected, () => {
          if (this.room === room) {
            this.room = null;
            this.update({
              camera: "error",
              audio: "error",
              cameraRef: null,
              audioRef: null,
              error: "Media disconnected. Reconnect camera and microphone.",
            });
          }
        });
        return room;
      } catch (error) {
        void room.disconnect();
        throw error;
      }
    })();
    this.pending = pending;
    try {
      return await pending;
    } finally {
      if (this.pending === pending) this.pending = null;
    }
  }
  async capture(kind: "camera" | "audio", deviceId: string | null) {
    const generation = this.generation;
    const attempt = ++this.attempts[kind];
    const current = () => generation === this.generation && attempt === this.attempts[kind];
    const previous = this.tracks.get(kind);
    if (previous) {
      void this.room?.localParticipant.unpublishTrack(previous);
      previous.stop();
      this.tracks.delete(kind);
    }
    this.update({ [kind]: "connecting", [`${kind}Ref`]: null });
    let acquired: MediaStream | undefined;
    try {
      // Ask independently: denying camera must not prevent microphone publication.
      acquired = await navigator.mediaDevices.getUserMedia({
        video: kind === "camera" ? (deviceId ? { deviceId: { exact: deviceId } } : true) : false,
        audio: kind === "audio" ? (deviceId ? { deviceId: { exact: deviceId } } : true) : false,
      });
      if (!current()) {
        acquired.getTracks().forEach((t) => t.stop());
        return;
      }
      const track = acquired.getTracks()[0];
      this.tracks.set(kind, track);
      const room = await this.connectRoom();
      if (!current()) {
        track.stop();
        return;
      }
      const publication = await room.localParticipant.publishTrack(track, {
        source: kind === "camera" ? Track.Source.Camera : Track.Source.Microphone,
      });
      if (!current()) {
        void room.localParticipant.unpublishTrack(track);
        track.stop();
        return;
      }
      const onEnded = () => {
        if (current()) {
          this.update({ [kind]: "unavailable", [`${kind}Ref`]: null });
          void room.localParticipant.unpublishTrack(track);
          this.tracks.delete(kind);
        }
      };
      track.addEventListener("ended", onEnded, { once: true });
      track.addEventListener("mute", () => {
        if (current()) this.update({ [kind]: "unavailable" });
      });
      track.addEventListener("unmute", () => {
        if (current()) this.update({ [kind]: "live" });
      });
      this.update({
        [kind]: "live",
        [`${kind}Ref`]: publication.trackSid,
        stream: new MediaStream([...this.tracks.values()]),
        error: null,
      });
    } catch (error) {
      acquired?.getTracks().forEach((t) => t.stop());
      if (current()) {
        this.tracks.delete(kind);
        this.update({
          [kind]: "error",
          [`${kind}Ref`]: null,
          error: error instanceof Error ? error.message : "Device unavailable. Reconnect to retry.",
        });
      }
    }
  }
  stop = () => {
    this.generation++;
    this.attempts.camera++;
    this.attempts.audio++;
    for (const track of this.tracks.values()) track.stop();
    this.tracks.clear();
    const room = this.room;
    this.room = null;
    this.pending = null;
    void room?.disconnect();
    this.update(EMPTY);
  };
}
