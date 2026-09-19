import { newestFix, toLiveFix } from "./position";
import type { LiveDevice, LiveFix, LiveTrackPayload } from "./types";

export interface TraccarSettings {
  baseUrl: string;
  email: string;
  password: string;
  /** Empty means every device the account can see. */
  deviceIds: number[];
}

interface TraccarDevice {
  id: number;
  name: string;
  status: string;
}

const REQUEST_TIMEOUT_MS = 6000;

function parseDeviceIds(raw: string | undefined): number[] {
  if (!raw?.trim()) return [];
  return raw
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((id) => Number.isInteger(id) && id > 0);
}

/**
 * Reads the tracking settings from the server environment. Returns null when the
 * integration is not configured, which the route reports as a normal state
 * rather than an error. No value here may be exposed to the browser.
 */
export function readSettings(env: Record<string, string | undefined>): TraccarSettings | null {
  const baseUrl = env.TRACCAR_URL?.trim();
  const email = env.TRACCAR_EMAIL?.trim();
  const password = env.TRACCAR_PASSWORD;

  if (!baseUrl || !email || !password) return null;

  // TRACCAR_DEVICE_ID is the superseded single-device name, still honoured.
  const deviceIds = parseDeviceIds(env.TRACCAR_DEVICE_IDS ?? env.TRACCAR_DEVICE_ID);

  return { baseUrl: baseUrl.replace(/\/+$/, ""), email, password, deviceIds };
}

function authHeader({ email, password }: TraccarSettings): string {
  return `Basic ${Buffer.from(`${email}:${password}`).toString("base64")}`;
}

async function getJson(settings: TraccarSettings, path: string): Promise<unknown> {
  const response = await fetch(`${settings.baseUrl}${path}`, {
    headers: { Authorization: authHeader(settings), Accept: "application/json" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    cache: "no-store",
  });

  if (!response.ok) {
    // The status is safe to surface; the body may echo request details.
    throw new Error(`Traccar responded ${response.status}`);
  }
  return response.json();
}

/**
 * Fetches every visible device and its newest fix in two requests, regardless of
 * fleet size. Only position data the dashboard renders crosses this boundary.
 */
export async function fetchLiveTrack(
  settings: TraccarSettings,
  now: Date,
): Promise<LiveTrackPayload> {
  const [devicesRaw, positionsRaw] = await Promise.all([
    getJson(settings, "/api/devices"),
    getJson(settings, "/api/positions"),
  ]);

  const allDevices = Array.isArray(devicesRaw) ? (devicesRaw as TraccarDevice[]) : [];
  const wanted = new Set(settings.deviceIds);
  const devices = allDevices.filter(
    (device) => typeof device?.id === "number" && (wanted.size === 0 || wanted.has(device.id)),
  );

  if (devices.length === 0) return { state: "no-devices" };

  // Group positions by device once, so a large fleet stays a single pass.
  const positions = Array.isArray(positionsRaw) ? positionsRaw : [];
  const fixesByDevice = new Map<number, LiveFix[]>();
  for (const entry of positions) {
    if (typeof entry !== "object" || entry === null) continue;
    const deviceId = (entry as Record<string, unknown>).deviceId;
    if (typeof deviceId !== "number") continue;

    const fix = toLiveFix(entry, now);
    if (!fix) continue;

    const existing = fixesByDevice.get(deviceId);
    if (existing) existing.push(fix);
    else fixesByDevice.set(deviceId, [fix]);
  }

  const tracked: LiveDevice[] = devices.map((device) => ({
    id: device.id,
    name: typeof device.name === "string" && device.name ? device.name : `Device ${device.id}`,
    online: device.status === "online",
    fix: newestFix(fixesByDevice.get(device.id) ?? []),
  }));

  // Freshest first, so the roster leads with the positions worth trusting.
  tracked.sort((left, right) => {
    if (!left.fix) return right.fix ? 1 : left.name.localeCompare(right.name);
    if (!right.fix) return -1;
    return left.fix.ageSeconds - right.fix.ageSeconds;
  });

  return { state: "tracking", devices: tracked };
}
