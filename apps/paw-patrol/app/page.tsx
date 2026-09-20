import { PawPatrol } from "@/features/paw-patrol/PawPatrol";
import { parseWorkspace, WORKSPACE_LABELS } from "@/features/paw-patrol/workspace";
import { connection } from "next/server";
import type { Metadata } from "next";

export async function generateMetadata(): Promise<Metadata> {
  await connection();
  const workspace = parseWorkspace(process.env.PAW_PATROL_WORKSPACE);
  return {
    title: `Paw Patrol · ${workspace ? WORKSPACE_LABELS[workspace] : "Connected response"}`,
  };
}

export default async function Home() {
  await connection();
  const workspace = parseWorkspace(process.env.PAW_PATROL_WORKSPACE);
  return <PawPatrol workspace={workspace} />;
}
