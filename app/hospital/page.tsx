import { connection } from "next/server";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { PawPatrol } from "@/features/paw-patrol/PawPatrol";
import { LiveWorkspace } from "@/features/live-incident/LiveWorkspace";
import { parseDataMode, pinnedElsewhere, WORKSPACE_LABELS } from "@/features/paw-patrol/workspace";

/**
 * The Hospital dashboard, pinned by its own URL.
 *
 * Demo observations use shared storage. In live mode the authenticated
 * backend session selects the operator's role, never the URL.
 */
export const metadata: Metadata = {
  title: `Paw Patrol · ${WORKSPACE_LABELS.hospital}`,
};

export default async function HospitalWorkspace() {
  // Read at request time: a server dedicated to another role serves nothing here.
  await connection();
  if (parseDataMode(process.env.PAW_PATROL_DATA_MODE) === "live") return <LiveWorkspace />;
  if (pinnedElsewhere("hospital", process.env.PAW_PATROL_WORKSPACE)) notFound();
  return <PawPatrol workspace="hospital" />;
}
