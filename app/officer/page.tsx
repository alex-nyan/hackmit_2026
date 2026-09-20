import { SharedWorkspace } from "@/features/officer-instance/SharedWorkspace";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { PawPatrol } from "@/features/paw-patrol/PawPatrol";
import { pinnedElsewhere, WORKSPACE_LABELS } from "@/features/paw-patrol/workspace";

/**
 * The Officer dashboard, pinned by its own URL.
 *
 * Opening this beside the other roles on one server gives three separate
 * dashboards that still share an incident log and a body camera wall — those
 * live in the server's memory, so three windows can share them and three
 * processes cannot.
 */
export const metadata: Metadata = {
  title: `Paw Patrol · ${WORKSPACE_LABELS.officer}`,
};

export default async function OfficerWorkspace() {
  // Read at request time: a server dedicated to another role serves nothing here.
  await connection();
  if (process.env.PAW_PATROL_BROADCAST_ENABLED !== "false")
    return <SharedWorkspace role="officer" />;
  if (pinnedElsewhere("officer", process.env.PAW_PATROL_WORKSPACE)) notFound();
  return <PawPatrol workspace="officer" />;
}
