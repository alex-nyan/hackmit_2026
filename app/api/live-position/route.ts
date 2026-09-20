import {
  isPositionStoreConfigured,
  listPublishedDevices,
} from "@/features/live-track/positionStore";
import { fetchLiveTrack, readSettings } from "@/features/live-track/traccarSource";
import type { LiveDevice, LiveTrackPayload } from "@/features/live-track/types";

/** Live location must never be prerendered or cached between requests. */
export const dynamic = "force-dynamic";

/**
 * Every unit the server can currently place, from either source.
 *
 * Phones publishing from the capture page are the source that works anywhere,
 * because the fix travels out from the device rather than needing a server it
 * can reach. Traccar stays supported for a deployment that has one, and the
 * two are merged rather than chosen between: a demo is often half of each.
 *
 * A phone-published unit wins a name collision — it is the more recent claim
 * about a unit id, and it is the one somebody is holding.
 */
function merge(published: LiveDevice[], traccar: LiveDevice[]): LiveDevice[] {
  const claimed = new Set(published.map((device) => device.id));
  return [...published, ...traccar.filter((device) => !claimed.has(device.id))];
}

export async function GET(): Promise<Response> {
  const settings = readSettings(process.env);
  const storeReady = isPositionStoreConfigured();

  if (!settings && !storeReady) {
    return Response.json({ state: "not-configured" } satisfies LiveTrackPayload, {
      headers: { "Cache-Control": "no-store" },
    });
  }

  // One source being down must not hide the other: a Traccar server that has
  // gone away should not take the phones off the map with it.
  const [published, tracked] = await Promise.all([
    storeReady ? listPublishedDevices().catch(() => [] as LiveDevice[]) : [],
    settings
      ? fetchLiveTrack(settings, new Date())
          .then((payload) => (payload.state === "tracking" ? payload.devices : []))
          .catch(() => [] as LiveDevice[])
      : [],
  ]);

  const devices = merge(published, tracked);
  if (devices.length === 0) {
    return Response.json({ state: "no-devices" } satisfies LiveTrackPayload, {
      headers: { "Cache-Control": "no-store" },
    });
  }

  return Response.json({ state: "tracking", devices } satisfies LiveTrackPayload, {
    headers: { "Cache-Control": "no-store" },
  });
}
