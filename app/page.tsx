import { SharedWorkspace } from "@/features/officer-instance/SharedWorkspace";
import { PawPatrol } from "@/features/paw-patrol/PawPatrol";
import { parseWorkspace, WORKSPACE_LABELS } from "@/features/paw-patrol/workspace";
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
  if (process.env.PAW_PATROL_BROADCAST_ENABLED !== "false")
    return <SharedWorkspace role={workspace ?? "dispatch"} />;
  return <PawPatrol workspace={workspace} />;
}
