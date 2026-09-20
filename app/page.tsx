import { headers } from "next/headers";
import { PawPatrol } from "@/features/paw-patrol/PawPatrol";
import { parseWorkspace, WORKSPACE_LABELS } from "@/features/paw-patrol/workspace";
import { buildJoinLink } from "@/features/join/joinLink";
import { connection } from "next/server";
import type { Metadata } from "next";
import { LiveWorkspace } from "@/features/live-incident/LiveWorkspace";

export async function generateMetadata(): Promise<Metadata> {
  await connection();
  const workspace = parseWorkspace(process.env.PAW_PATROL_WORKSPACE);
  return {
    title: `Paw Patrol · ${workspace ? WORKSPACE_LABELS[workspace] : "Connected response"}`,
    description:
      process.env.PAW_PATROL_DATA_MODE === "live"
        ? "Authenticated incident observations and human-reviewed coordination."
        : "A HackMIT demonstration using simulated incident signals.",
  };
}

export default async function Home() {
  await connection();
  const workspace = parseWorkspace(process.env.PAW_PATROL_WORKSPACE);
  const mode = process.env.PAW_PATROL_DATA_MODE ?? "demo";
  if (mode !== "demo" && mode !== "live")
    throw new Error("PAW_PATROL_DATA_MODE must be demo or live.");
  if (mode === "live") return <LiveWorkspace />;
  // Resolved from the request rather than configured: the address a phone
  // should scan is whichever one this dashboard was actually opened on.
  const join = await buildJoinLink(await headers());
  return <PawPatrol workspace={workspace} join={join} />;
}
