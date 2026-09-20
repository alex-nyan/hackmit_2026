import { WorkspaceHome } from "@/features/workspace-home/WorkspaceHome";
import { PawPatrol } from "@/features/paw-patrol/PawPatrol";
import { parseDataMode, parseWorkspace, WORKSPACE_LABELS } from "@/features/paw-patrol/workspace";
import { connection } from "next/server";
import type { Metadata } from "next";
import { LiveWorkspace } from "@/features/live-incident/LiveWorkspace";

export async function generateMetadata(): Promise<Metadata> {
  await connection();
  const workspace = parseWorkspace(process.env.PAW_PATROL_WORKSPACE);
  return {
    title: `Paw Patrol · ${workspace ? WORKSPACE_LABELS[workspace] : "Connected response"}`,
    description:
      parseDataMode(process.env.PAW_PATROL_DATA_MODE) === "live"
        ? "Authenticated incident observations and human-reviewed coordination."
        : "A HackMIT demonstration using simulated incident signals.",
  };
}

export default async function Home({ searchParams }: { searchParams: Promise<{ demo?: string }> }) {
  await connection();
  const workspace = parseWorkspace(process.env.PAW_PATROL_WORKSPACE);
  const mode = parseDataMode(process.env.PAW_PATROL_DATA_MODE);
  if (mode === "live") return <LiveWorkspace />;
  const { demo } = await searchParams;
  if (workspace || demo === "1") return <PawPatrol workspace={workspace} />;
  return <WorkspaceHome />;
}
