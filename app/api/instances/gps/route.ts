import { fetchLiveTrack, readSettings } from "@/features/live-track/traccarSource";
import { respond } from "@/features/officer-instance/server";
import { InstanceError } from "@/features/officer-instance/model";
export const dynamic = "force-dynamic";
export async function GET() {
  return respond(async () => {
    const settings = readSettings(process.env);
    if (!settings) return { state: "not-configured" };
    if (process.env.VERCEL && !settings.baseUrl.startsWith("https://"))
      throw new InstanceError("Use a public HTTPS Traccar endpoint on Vercel.", 503);
    return fetchLiveTrack(settings, new Date());
  });
}
