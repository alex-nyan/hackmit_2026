import { classifyFreshness } from "../live-track/position";
import type { LiveDevice } from "../live-track/types";
import {
  HEART_STALE_MS,
  HEART_WINDOW_MS,
  INSTANCE_TTL_MS,
  OFFLINE_MS,
  type Command,
  type OfficerInstance,
} from "./types";

export class InstanceError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly code?: string,
  ) {
    super(message);
  }
}
export interface StoredInstance {
  instance: OfficerInstance;
  ownerHash: string;
  sequences: Record<string, number>;
  heartPublishedAt: number;
  gpsPolledAt: number;
}
export function createInstance(
  id: string,
  displayName: string,
  ownerHash: string,
  now: number,
): StoredInstance {
  if (!displayName.trim() || displayName.trim().length > 80)
    throw new InstanceError("Enter an officer name of 1–80 characters.");
  return {
    ownerHash,
    sequences: {},
    heartPublishedAt: 0,
    gpsPolledAt: 0,
    instance: {
      id,
      displayName: displayName.trim(),
      revision: 1,
      lifecycle: "ready",
      createdAt: now,
      expiresAt: now + INSTANCE_TTL_MS,
      heartbeatAt: now,
      startedAt: null,
      media: { room: `officer-${id}`, publisher: `publisher-${id}`, camera: null, audio: null },
      gps: null,
      heart: [],
      hospitalRequested: false,
      scene: { status: "unknown", reportedAt: null },
      sources: {
        camera: { state: "unavailable", updatedAt: now },
        audio: { state: "unavailable", updatedAt: now },
        gps: { state: "unavailable", updatedAt: now },
        heart: { state: "unavailable", updatedAt: now },
      },
    },
  };
}
/** Freshness is evaluated on every read; cached readings never become current on reconnect. */
export function publicInstance(stored: StoredInstance, now: number): OfficerInstance {
  const i = structuredClone(stored.instance);
  if (i.expiresAt <= now) {
    i.lifecycle = "ended";
    i.hospitalRequested = false;
  } else if (i.lifecycle !== "ended" && now - i.heartbeatAt >= OFFLINE_MS) i.lifecycle = "offline";
  i.heart = i.heart.filter((s) => s.receivedAt >= now - HEART_WINDOW_MS);
  if (
    i.sources.heart.state === "live" &&
    (!i.heart.length || now - i.heart.at(-1)!.receivedAt >= HEART_STALE_MS)
  )
    i.sources.heart.state = "stale";
  if (i.gps?.fix) {
    i.gps.fix.ageSeconds = Math.max(0, Math.round((now - Date.parse(i.gps.fix.fixedAt)) / 1000));
    i.gps.fix.freshness = classifyFreshness(i.gps.fix.ageSeconds);
    if (i.sources.gps.state === "live" && i.gps.fix.freshness !== "live")
      i.sources.gps.state = "stale";
  }
  if (i.lifecycle !== "broadcasting") {
    for (const source of Object.values(i.sources))
      if (source.state === "live" || source.state === "connecting") source.state = "stale";
  }
  return i;
}
export function owns(stored: StoredInstance, id: string, hash: string) {
  if (
    stored.instance.id !== id ||
    stored.ownerHash !== hash ||
    stored.instance.lifecycle === "ended"
  )
    throw new InstanceError("This controller no longer owns the instance.", 409);
}
export function applyCommand(
  stored: StoredInstance,
  command: Command,
  now: number,
  sequence?: number,
  gps?: LiveDevice | null,
): StoredInstance {
  const next = structuredClone(stored);
  const i = next.instance;
  if (i.lifecycle === "ended" || i.expiresAt <= now)
    throw new InstanceError("This instance has ended.", 409);
  const publisher = command.type !== "assignment" && command.type !== "scene";
  if (publisher) {
    if (!Number.isSafeInteger(sequence) || sequence! <= (next.sequences[command.type] ?? 0))
      throw new InstanceError(
        "A newer controller update has already arrived.",
        409,
        "stale_update",
      );
    next.sequences[command.type] = sequence!;
  }
  switch (command.type) {
    case "start":
      if (i.lifecycle === "ready") {
        i.lifecycle = "broadcasting";
        i.startedAt = now;
      }
      i.heartbeatAt = now;
      break;
    case "heartbeat":
      i.heartbeatAt = now;
      break;
    case "stop":
      i.lifecycle = "ended";
      i.hospitalRequested = false;
      i.media.camera = i.media.audio = null;
      for (const source of Object.values(i.sources)) {
        source.state = "unavailable";
        source.updatedAt = now;
      }
      break;
    case "assignment":
      i.hospitalRequested = command.requested;
      break;
    case "scene":
      i.scene = { status: command.status, reportedAt: now };
      break;
    case "gps":
      if (i.lifecycle !== "broadcasting")
        throw new InstanceError("Start broadcasting before publishing GPS.", 409);
      if (now - next.gpsPolledAt < 5000) break;
      next.gpsPolledAt = now;
      if (
        !gps ||
        gps.id !== i.gps?.id ||
        !i.gps.fix ||
        (gps.fix && Date.parse(gps.fix.fixedAt) >= Date.parse(i.gps.fix.fixedAt))
      )
        i.gps = gps ?? null;
      i.sources.gps = {
        state: gps?.fix ? (gps.fix.freshness === "live" ? "live" : "stale") : "unavailable",
        updatedAt: now,
      };
      break;
    case "telemetry": {
      if (i.lifecycle !== "broadcasting")
        throw new InstanceError("Start broadcasting before publishing telemetry.", 409);
      for (const [name, state] of Object.entries(command.sources ?? {}))
        i.sources[name as keyof typeof i.sources] = { state, updatedAt: now };
      if (command.camera !== undefined) i.media.camera = command.camera;
      if (command.audio !== undefined) i.media.audio = command.audio;
      const sample = command.heart;
      if (
        sample &&
        now - next.heartPublishedAt >= 1000 &&
        sample.receivedAt > (i.heart.at(-1)?.receivedAt ?? 0) &&
        sample.receivedAt >= (i.startedAt ?? now) &&
        sample.receivedAt <= now + 5000 &&
        now - sample.receivedAt < HEART_STALE_MS
      ) {
        i.heart.push(sample);
        next.heartPublishedAt = now;
      }
      break;
    }
  }
  i.heart = i.heart.filter((s) => s.receivedAt >= now - HEART_WINDOW_MS).slice(-60);
  i.revision += 1;
  return next;
}
