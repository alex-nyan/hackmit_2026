import { createHash, randomBytes, randomUUID } from "node:crypto";
import { AccessToken, RoomServiceClient, TrackSource } from "livekit-server-sdk";
import { readSettings, fetchLiveTrack } from "../live-track/traccarSource";
import {
  applyCommand,
  createInstance,
  InstanceError,
  owns,
  publicInstance,
  type StoredInstance,
} from "./model";
import { instanceStore, transact } from "./store";
import type { Command, Ownership, SourceName, SourceState } from "./types";

const hash = (secret: string) => createHash("sha256").update(secret).digest("hex");
export function mediaConfig() {
  const url = process.env.LIVEKIT_URL;
  const key = process.env.LIVEKIT_API_KEY;
  const secret = process.env.LIVEKIT_API_SECRET;
  if (!url || !key || !secret)
    throw new InstanceError("Configure LiveKit Cloud for camera and audio broadcasting.", 503);
  return { url, key, secret };
}
async function endRoom(stored: StoredInstance) {
  if (!process.env.LIVEKIT_URL) return;
  const { url, key, secret } = mediaConfig();
  const client = new RoomServiceClient(url.replace(/^ws/, "http"), key, secret);
  const rooms = await client.listRooms([stored.instance.media.room]);
  if (rooms.length) await client.deleteRoom(stored.instance.media.room);
}
export async function readInstance() {
  const raw = await instanceStore().read();
  return raw ? (JSON.parse(raw) as StoredInstance) : null;
}
export async function snapshot(hospital = false) {
  const stored = await readInstance();
  const now = Date.now();
  const instance = stored ? publicInstance(stored, now) : null;
  return {
    instance: instance && (!hospital || instance.hospitalRequested) ? instance : null,
    serverTime: now,
  };
}
export async function create(displayName: string, replaceId?: string) {
  if (!displayName.trim() || displayName.trim().length > 80)
    throw new InstanceError("Enter an officer name of 1–80 characters.");
  const store = instanceStore();
  // End and revoke the old room before publishing a replacement. A failed revoke
  // leaves it ended and can be retried; two controllers cannot both replace it.
  if (replaceId) {
    const ended = await transact(
      store,
      (current) => {
        if (!current || current.instance.id !== replaceId)
          throw new InstanceError("The active instance changed. Refresh before replacing it.", 409);
        const next = structuredClone(current);
        next.instance.lifecycle = "ended";
        next.instance.hospitalRequested = false;
        next.instance.revision++;
        return next;
      },
      Date.now(),
    );
    await endRoom(ended);
  }
  if (!replaceId) {
    const previous = await store.read();
    if (previous) {
      const retired = JSON.parse(previous) as StoredInstance;
      if (retired.instance.lifecycle === "ended") await endRoom(retired);
    }
  }
  const id = randomUUID();
  const secret = randomBytes(32).toString("hex");
  const now = Date.now();
  const next = createInstance(id, displayName, hash(secret), now);
  const stored = await transact(
    store,
    (current) => {
      if (
        current &&
        current.instance.expiresAt > now &&
        (current.instance.lifecycle !== "ended" || (replaceId && current.instance.id !== replaceId))
      )
        throw new InstanceError(
          "An instance already exists. Explicitly replace it to end its broadcast.",
          409,
        );
      return next;
    },
    now,
  );
  return {
    ...{ instance: publicInstance(stored, now), serverTime: now },
    ownership: { id, secret, createdAt: now },
  };
}
export async function command(id: string, action: Command, secret: string, sequence?: number) {
  const now = Date.now();
  const store = instanceStore();
  const isPublisher = action.type !== "assignment" && action.type !== "scene";
  const initial = await readInstance();
  if (!initial || initial.instance.id !== id)
    throw new InstanceError("The instance is no longer active.", 409);
  if (
    action.type === "stop" &&
    initial.instance.lifecycle === "ended" &&
    initial.ownerHash === hash(secret)
  ) {
    await endRoom(initial);
    return snapshot();
  }
  if (isPublisher) owns(initial, id, hash(secret));
  let gps: import("../live-track/types").LiveDevice | null = null;
  if (action.type === "gps" && action.deviceId !== null && now - initial.gpsPolledAt >= 5000) {
    const settings = readSettings(process.env);
    if (settings) {
      if (process.env.VERCEL && !settings.baseUrl.startsWith("https://"))
        throw new InstanceError("Use a public HTTPS Traccar endpoint on Vercel.", 503);
      try {
        const result = await fetchLiveTrack(settings, new Date(now));
        if (result.state === "tracking")
          gps = result.devices.find((d) => d.id === action.deviceId) ?? null;
      } catch {
        /* Source unavailable, independent of camera/audio/heart. */
      }
    }
  }
  const stored = await transact(
    store,
    (current) => {
      if (!current || current.instance.id !== id)
        throw new InstanceError("The instance was replaced.", 409);
      if (isPublisher) owns(current, id, hash(secret));
      return applyCommand(current, action, now, sequence, gps);
    },
    now,
  );
  if (action.type === "stop") await endRoom(stored);
  return { instance: publicInstance(stored, Date.now()), serverTime: Date.now() };
}
export async function mediaToken(
  id: string,
  role: "publisher" | "viewer" | "hospital",
  ownershipSecret: string,
) {
  const stored = await readInstance();
  const now = Date.now();
  if (
    !stored ||
    stored.instance.id !== id ||
    publicInstance(stored, now).lifecycle !== "broadcasting"
  )
    throw new InstanceError("There is no active broadcast.", 409);
  if (role === "publisher") owns(stored, id, hash(ownershipSecret));
  if (role === "hospital" && !stored.instance.hospitalRequested)
    throw new InstanceError("No officer requested.", 403);
  const { url, key, secret } = mediaConfig();
  const token = new AccessToken(key, secret, {
    identity: role === "publisher" ? stored.instance.media.publisher : `${role}-${randomUUID()}`,
    ttl: 60,
  });
  token.addGrant({
    room: stored.instance.media.room,
    roomJoin: true,
    canPublish: role === "publisher",
    canSubscribe: role !== "publisher",
    canPublishData: false,
    canPublishSources: role === "publisher" ? [TrackSource.CAMERA, TrackSource.MICROPHONE] : [],
  });
  return { url, token: await token.toJwt() };
}
export function ownerFrom(request: Request): string {
  return request.headers.get("x-publisher-secret") ?? "";
}
export type CreateResponse = Awaited<ReturnType<typeof create>> & { ownership: Ownership };

export async function body(request: Request): Promise<Record<string, unknown>> {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin)
    throw new InstanceError("Cross-origin writes are not allowed.", 403);
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    throw new InstanceError("Use application/json.", 415);
  const text = await request.text();
  if (text.length > 8192) throw new InstanceError("Request too large.", 413);
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new InstanceError("Invalid JSON.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new InstanceError("Expected an object.");
  return value as Record<string, unknown>;
}
export function parseCommand(raw: Record<string, unknown>): Command {
  const type = raw.type;
  if (type === "start" || type === "stop" || type === "heartbeat") return { type };
  if (type === "assignment" && typeof raw.requested === "boolean")
    return { type, requested: raw.requested };
  if (
    type === "scene" &&
    (raw.status === "unknown" || raw.status === "unsafe" || raw.status === "cleared")
  )
    return { type, status: raw.status };
  if (
    type === "gps" &&
    (raw.deviceId === null ||
      (typeof raw.deviceId === "string" && /^[1-9]\d{0,14}$/.test(raw.deviceId)))
  )
    return { type, deviceId: raw.deviceId as string | null };
  if (type === "telemetry") {
    const result: Extract<Command, { type: "telemetry" }> = { type };
    if (raw.sources !== undefined) {
      if (!raw.sources || typeof raw.sources !== "object" || Array.isArray(raw.sources))
        throw new InstanceError("Invalid sources.");
      result.sources = {};
      for (const [name, state] of Object.entries(raw.sources)) {
        if (
          !["camera", "audio", "heart"].includes(name) ||
          !["unavailable", "connecting", "live", "stale", "error"].includes(state as string)
        )
          throw new InstanceError("Invalid source status.");
        result.sources[name as SourceName] = state as SourceState;
      }
    }
    for (const key of ["camera", "audio"] as const) {
      if (raw[key] !== undefined) {
        if (
          raw[key] !== null &&
          (typeof raw[key] !== "string" || (raw[key] as string).length > 128)
        )
          throw new InstanceError("Invalid media reference.");
        result[key] = raw[key] as string | null;
      }
    }
    if (raw.heart !== undefined) {
      const sample = raw.heart as Record<string, unknown> | null;
      if (
        !sample ||
        typeof sample.bpm !== "number" ||
        !Number.isFinite(sample.bpm) ||
        sample.bpm < 1 ||
        sample.bpm > 300 ||
        typeof sample.receivedAt !== "number" ||
        !Number.isFinite(sample.receivedAt)
      )
        throw new InstanceError("Invalid heart-rate sample.");
      result.heart = { bpm: sample.bpm, receivedAt: sample.receivedAt };
    }
    return result;
  }
  throw new InstanceError("Invalid instance command.");
}
export async function respond(run: () => Promise<unknown>) {
  try {
    return Response.json(await run(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json(
      {
        ...(error instanceof InstanceError && error.code ? { code: error.code } : {}),
        error:
          error instanceof InstanceError
            ? error.message
            : "Shared service unavailable. Check configuration and retry.",
      },
      {
        status: error instanceof InstanceError ? error.status : 503,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
