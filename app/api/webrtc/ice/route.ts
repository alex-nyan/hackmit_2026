import { readIceServers } from "@/features/live-video/iceServers";

/**
 * What the browsers should use to find each other.
 *
 * Served rather than compiled in so relay credentials stay out of the client
 * bundle and can be rotated without a deploy. A browser still receives them —
 * it has to, to authenticate to the relay — but they are fetched by a page
 * that is already behind the passphrase rather than published in a script
 * anyone can read.
 */

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return Response.json(readIceServers(process.env), {
    headers: { "Cache-Control": "no-store" },
  });
}
