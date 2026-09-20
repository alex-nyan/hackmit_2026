import { DEMO_HEALTH_CENTRES, type DemoAmbulanceMission } from "./demoAmbulance";
import type { VehiclePoint } from "./vehicles/vehicleMotion";

export const DEMO_HANDOFF_CHANNEL = "paw-patrol-frontend-demo-handoff-v1";
export const DEMO_HANDOFF_STORAGE = "paw-patrol.frontend-demo-handoff.v1";
export const DEMO_HANDOFF_STALE_MS = 15_000;
export const DEMO_HANDOFF_MAX_BYTES = 65_536;
const MAX_MISSIONS = 64;
const LOCAL_PORTS = new Set(["5176", "5177", "5178"]);
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

export type DemoHandoffSnapshot = {
  schema: 1;
  source: "frontend-demo";
  publisherId: string;
  updatedAt: string;
  missions: DemoAmbulanceMission[];
};

/** Only this browser's tabs share this demo; this is not authentication or a server. */
export function demoBridgeOrigin(origin: string): string {
  const url = new URL(origin);
  if (LOCAL_HOSTS.has(url.hostname) && LOCAL_PORTS.has(url.port)) url.port = "5176";
  return url.origin;
}

export function allowedDemoParent(parentOrigin: string, bridgeOrigin: string): boolean {
  try {
    const parent = new URL(parentOrigin);
    const bridge = new URL(bridgeOrigin);
    if (parent.origin !== parentOrigin || !["http:", "https:"].includes(parent.protocol))
      return false;
    if (parent.origin === bridge.origin) return true;
    return (
      LOCAL_HOSTS.has(bridge.hostname) &&
      parent.hostname === bridge.hostname &&
      parent.protocol === bridge.protocol &&
      LOCAL_PORTS.has(bridge.port) &&
      LOCAL_PORTS.has(parent.port)
    );
  } catch {
    return false;
  }
}

export function demoMessageRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  try {
    if (new TextEncoder().encode(JSON.stringify(value)).byteLength > DEMO_HANDOFF_MAX_BYTES)
      return null;
  } catch {
    return null;
  }
  return value as Record<string, unknown>;
}

function shortString(value: unknown, maximum = 100): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximum;
}

export function validDemoClientId(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{8,100}$/.test(value);
}

function isoDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

function coordinate(value: unknown): value is VehiclePoint {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === "number" &&
    Number.isFinite(value[0]) &&
    Math.abs(value[0]) <= 180 &&
    typeof value[1] === "number" &&
    Number.isFinite(value[1]) &&
    Math.abs(value[1]) <= 85
  );
}

function clockNumber(value: unknown): value is number {
  return (
    typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1_000_000_000
  );
}

function readMission(value: unknown): DemoAmbulanceMission | null {
  const mission = demoMessageRecord(value);
  if (!mission) return null;
  if (
    !shortString(mission.id) ||
    !/^demo-ambulance-[a-zA-Z0-9_-]+$/.test(mission.id) ||
    !shortString(mission.hotspotId) ||
    !/^H-\d{2,9}$/.test(mission.hotspotId) ||
    !shortString(mission.stationName) ||
    !coordinate(mission.hotspotPoint) ||
    !coordinate(mission.stationPoint) ||
    !coordinate(mission.stagingPoint) ||
    !clockNumber(mission.startedAt) ||
    !clockNumber(mission.duration) ||
    mission.duration <= 0 ||
    mission.duration > 3_600 ||
    !["en-route", "staged", "engaged", "cancelled"].includes(String(mission.status)) ||
    !isoDate(mission.createdAt) ||
    !isoDate(mission.updatedAt) ||
    Date.parse(mission.updatedAt) < Date.parse(mission.createdAt) ||
    (mission.engagedAt !== null && !isoDate(mission.engagedAt)) ||
    (mission.status === "engaged" && mission.engagedAt === null) ||
    (mission.stoppedAt !== undefined && !clockNumber(mission.stoppedAt))
  )
    return null;
  const station = DEMO_HEALTH_CENTRES.find((candidate) => candidate.name === mission.stationName);
  if (
    !station ||
    station.point.some(
      (part, index) => Math.abs(part - (mission.stationPoint as VehiclePoint)[index]) > 0.0000001,
    )
  )
    return null;
  // Copy an allowlist only: no route geometry, patients, vitals, credentials or AI payloads.
  return {
    id: mission.id,
    hotspotId: mission.hotspotId,
    hotspotPoint: [...mission.hotspotPoint],
    stationName: mission.stationName,
    stationPoint: [...mission.stationPoint],
    stagingPoint: [...mission.stagingPoint],
    route: [],
    startedAt: mission.startedAt,
    duration: mission.duration,
    status: mission.status as DemoAmbulanceMission["status"],
    createdAt: mission.createdAt,
    updatedAt: mission.updatedAt,
    engagedAt: mission.engagedAt as string | null,
    ...(mission.stoppedAt !== undefined ? { stoppedAt: mission.stoppedAt as number } : {}),
  };
}

export function parseDemoHandoffSnapshot(value: unknown): DemoHandoffSnapshot | null {
  const snapshot = demoMessageRecord(value);
  if (
    !snapshot ||
    snapshot.schema !== 1 ||
    snapshot.source !== "frontend-demo" ||
    !validDemoClientId(snapshot.publisherId) ||
    !isoDate(snapshot.updatedAt) ||
    Date.parse(snapshot.updatedAt) > Date.now() + 5_000 ||
    !Array.isArray(snapshot.missions) ||
    snapshot.missions.length > MAX_MISSIONS
  )
    return null;
  const missions: DemoAmbulanceMission[] = [];
  const ids = new Set<string>();
  for (const value of snapshot.missions) {
    const mission = readMission(value);
    if (!mission || ids.has(mission.id)) return null;
    ids.add(mission.id);
    missions.push(mission);
  }
  return {
    schema: 1,
    source: "frontend-demo",
    publisherId: snapshot.publisherId,
    updatedAt: snapshot.updatedAt,
    missions,
  };
}

export function makeDemoHandoffSnapshot(
  publisherId: string,
  missions: DemoAmbulanceMission[],
): DemoHandoffSnapshot | null {
  // Discard the large road geometry before the bounded validation step.
  return parseDemoHandoffSnapshot({
    schema: 1,
    source: "frontend-demo",
    publisherId,
    updatedAt: new Date().toISOString(),
    missions: missions.map(({ route: _route, ...mission }) => {
      void _route;
      return mission;
    }),
  });
}

export function demoSnapshotIsFresh(snapshot: DemoHandoffSnapshot, now = Date.now()): boolean {
  const age = now - Date.parse(snapshot.updatedAt);
  return age >= -5_000 && age < DEMO_HANDOFF_STALE_MS;
}
