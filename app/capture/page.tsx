import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Metadata } from "next";

import { findOfficer, publicOfficer, readRoster } from "@/features/access/roster";
import { OFFICER_COOKIE, readSession } from "@/features/access/session";
import { CameraTriageView } from "@/features/camera-triage";

export const metadata: Metadata = {
  title: "Paw Patrol - Camera",
  description: "Send camera frames for hazard triage.",
};

export const dynamic = "force-dynamic";

/**
 * The officer's own page, and the only one that needs to know who they are.
 *
 * Identity is resolved on the server: what the browser gets is a name to
 * display and an id to publish under, never the roster or a passcode. With no
 * roster configured the page stays as it was, so a deployment that has not set
 * one up is not locked out of its own camera.
 */
export default async function CapturePage() {
  const roster = readRoster(process.env);
  if (roster.length === 0) return <CameraTriageView />;

  const jar = await cookies();
  const officerId = await readSession(
    jar.get(OFFICER_COOKIE)?.value,
    process.env.PAW_PATROL_OFFICERS ?? "",
  );
  const officer = officerId ? findOfficer(roster, officerId) : null;
  if (!officer) redirect("/sign-in");

  return <CameraTriageView officer={publicOfficer(officer)} />;
}
