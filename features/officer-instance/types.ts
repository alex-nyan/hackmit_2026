import type { LiveDevice } from "../live-track/types";
import type { HeartRateSample } from "../heart-rate/useHeartRate";

export type SourceName = "camera" | "audio" | "gps" | "heart";
export type SourceState = "unavailable" | "connecting" | "live" | "stale" | "error";
export interface SourceStatus {
  state: SourceState;
  updatedAt: number;
}
export interface OfficerInstance {
  id: string;
  displayName: string;
  revision: number;
  lifecycle: "ready" | "broadcasting" | "offline" | "ended";
  createdAt: number;
  expiresAt: number;
  heartbeatAt: number;
  startedAt: number | null;
  media: { room: string; publisher: string; camera: string | null; audio: string | null };
  gps: LiveDevice | null;
  heart: HeartRateSample[];
  sources: Record<SourceName, SourceStatus>;
  hospitalRequested: boolean;
  scene: { status: "unknown" | "unsafe" | "cleared"; reportedAt: number | null };
}
export interface InstanceSnapshot {
  instance: OfficerInstance | null;
  serverTime: number;
}
export interface Ownership {
  id: string;
  secret: string;
  createdAt: number;
}
export type PublisherCommand =
  | { type: "start" | "heartbeat" | "stop" }
  | {
      type: "telemetry";
      sources?: Partial<Record<SourceName, SourceState>>;
      heart?: HeartRateSample;
      camera?: string | null;
      audio?: string | null;
    }
  | { type: "gps"; deviceId: string | null };
export type Command =
  | PublisherCommand
  | { type: "assignment"; requested: boolean }
  | { type: "scene"; status: "unknown" | "unsafe" | "cleared" };
export const HEART_WINDOW_MS = 60_000;
export const HEART_STALE_MS = 30_000;
export const OFFLINE_MS = 15_000;
export const INSTANCE_TTL_MS = 86_400_000;
