import { matches } from "@/features/access/passphrase";
import { findOfficer, readRoster } from "@/features/access/roster";
import { clearedSessionCookie, issueSession, sessionCookie } from "@/features/access/session";

/** Exchanges an officer's passcode for the cookie that carries their identity. */
export const dynamic = "force-dynamic";

function backToForm(request: Request, officerId: string, problem: string): Response {
  const retry = new URL("/sign-in", request.url);
  if (officerId) retry.searchParams.set("officer", officerId);
  retry.searchParams.set("problem", problem);
  return Response.redirect(retry, 303);
}

export async function POST(request: Request): Promise<Response> {
  const form = await request.formData();

  // Signing out is the same door, walked the other way.
  if (form.get("action") === "sign-out") {
    const out = new Response(null, {
      status: 303,
      headers: { Location: new URL("/sign-in", request.url).toString() },
    });
    out.headers.append("Set-Cookie", clearedSessionCookie);
    return out;
  }

  const rosterRaw = process.env.PAW_PATROL_OFFICERS ?? "";
  const roster = readRoster(process.env);
  if (roster.length === 0) return backToForm(request, "", "no-roster");

  const officerId = String(form.get("officer") ?? "");
  const passcode = String(form.get("passcode") ?? "");
  const officer = findOfficer(roster, officerId);

  // Compared even when the officer is unknown, so a wrong name and a wrong
  // passcode take the same time and reveal the same thing.
  const accepted = matches(passcode, officer?.passcode ?? ` ${passcode}`);
  if (!officer || !accepted) return backToForm(request, officerId, "rejected");

  const response = new Response(null, {
    status: 303,
    headers: { Location: new URL("/capture", request.url).toString() },
  });
  response.headers.append("Set-Cookie", sessionCookie(await issueSession(officer.id, rosterRaw)));
  return response;
}
