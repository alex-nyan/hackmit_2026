import { fetchLiveTrack, readSettings } from "@/features/live-track/traccarSource";
import type { LiveTrackPayload } from "@/features/live-track/types";

/** Live location must never be prerendered or cached between requests. */
export const dynamic = "force-dynamic";

export async function GET() {
  const settings = readSettings(process.env);
  if (!settings) {
    return Response.json({ state: "not-configured" } satisfies LiveTrackPayload, {
      headers: { "Cache-Control": "no-store" },
    });
  }

  try {
    const payload = await fetchLiveTrack(settings, new Date());
    return Response.json(payload, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    // Never echo the upstream URL or credentials into the browser.
    const reason =
      error instanceof Error && error.name === "TimeoutError"
        ? "The tracking server did not respond in time."
        : "The tracking server could not be reached.";
    return Response.json({ state: "unavailable", reason } satisfies LiveTrackPayload, {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
