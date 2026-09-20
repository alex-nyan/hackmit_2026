import { headers } from "next/headers";
import { PawPatrol } from "@/features/paw-patrol/PawPatrol";
import { parseWorkspace, WORKSPACE_LABELS } from "@/features/paw-patrol/workspace";
import { buildJoinLink } from "@/features/join/joinLink";
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
  // Resolved from the request rather than configured: the address a phone
  // should scan is whichever one this dashboard was actually opened on.
  const join = await buildJoinLink(await headers());
  return <PawPatrol workspace={workspace} join={join} />;
}
