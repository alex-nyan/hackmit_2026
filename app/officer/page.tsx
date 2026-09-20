import { connection } from "next/server";
import { cookies } from "next/headers";
import { findOfficer, publicOfficer, readRoster } from "@/features/access/roster";
import { OFFICER_COOKIE, readSession } from "@/features/access/session";
import { redirect, notFound } from "next/navigation";
import type { Metadata } from "next";

import { PawPatrol } from "@/features/paw-patrol/PawPatrol";
import { LiveWorkspace } from "@/features/live-incident/LiveWorkspace";
import { parseDataMode, pinnedElsewhere, WORKSPACE_LABELS } from "@/features/paw-patrol/workspace";

/**
 * The Officer dashboard, pinned by its own URL.
 *
 * Demo observations use shared storage. In live mode the authenticated
 * backend session selects the operator's role, never the URL.
 */
export const metadata: Metadata = {
  title: `Paw Patrol · ${WORKSPACE_LABELS.officer}`,
};

export default async function OfficerWorkspace() {
  // Read at request time: a server dedicated to another role serves nothing here.
  await connection();
  if (parseDataMode(process.env.PAW_PATROL_DATA_MODE) === "live") return <LiveWorkspace />;
  const roster = readRoster(process.env);
  const jar = await cookies();
  const id = await readSession(
    jar.get(OFFICER_COOKIE)?.value,
    process.env.PAW_PATROL_OFFICERS ?? "",
  );
  const officer = id ? findOfficer(roster, id) : null;
  if (roster.length && !officer) redirect("/sign-in");
  // A signed-in officer must stay on the same origin as dispatch so media and
  // incidents share one backend, even when the default dashboard is pinned.
  if (!officer && pinnedElsewhere("officer", process.env.PAW_PATROL_WORKSPACE)) notFound();
  return <PawPatrol workspace="officer" officer={officer ? publicOfficer(officer) : null} />;
}
