import {
  MEMORY_FALLBACK_NOTE,
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

interface PublishedRead {
  devices: LiveDevice[];
  /** Said out loud on the dashboard when the answer came from somewhere lesser. */
  note?: string;
  /** The read did not happen at all, as opposed to happening and finding nobody. */
  failed: boolean;
}

const NOTHING_PUBLISHED: PublishedRead = { devices: [], failed: false };

/**
 * Reads the published units, and remembers how that went.
 *
 * The distinction this keeps is the one the old `catch(() => [])` threw away:
 * a store that refused to answer is not a street with nobody on it. Reporting
 * the second when the first happened is how somebody scans the code, taps the
 * button, and is told the map is working fine and they are simply not on it.
 */
async function readPublished(): Promise<PublishedRead> {
  try {
    const { devices, source } = await listPublishedDevices();
    return {
      devices,
      failed: false,
      ...(source === "memory" ? { note: MEMORY_FALLBACK_NOTE } : {}),
    };
  } catch {
    return { devices: [], failed: true };
  }
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
    storeReady ? readPublished() : NOTHING_PUBLISHED,
    settings
      ? fetchLiveTrack(settings, new Date())
          .then((payload) => (payload.state === "tracking" ? payload.devices : []))
          .catch(() => [] as LiveDevice[])
      : [],
  ]);

  const devices = merge(published.devices, tracked);
  const note = published.note ? { note: published.note } : {};

  if (devices.length === 0) {
    // Nothing to draw and the one source that could have drawn it never
    // answered. That is an outage, and it is worth saying so rather than
    // letting it read as a quiet shift.
    if (published.failed) {
      return Response.json(
        {
          state: "unavailable",
          reason: "The position store could not be read, so nobody can appear on the map.",
        } satisfies LiveTrackPayload,
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    return Response.json({ state: "no-devices", ...note } satisfies LiveTrackPayload, {
      headers: { "Cache-Control": "no-store" },
    });
  }

  return Response.json({ state: "tracking", devices, ...note } satisfies LiveTrackPayload, {
    headers: { "Cache-Control": "no-store" },
  });
}
