import type { NextRequest } from "next/server";
import { COOKIE_NAME, digest, matches, requiredPassphrase } from "@/features/access/passphrase";
import { findOfficer, readRoster } from "@/features/access/roster";
import {
  clearedSessionCookie,
  issueSession,
  OFFICER_COOKIE,
  readSession,
  sessionCookie,
} from "@/features/access/session";

/** Records a configured demo profile selection without an officer password. */
export const dynamic = "force-dynamic";

function backToForm(request: Request, officerId: string, problem: string): Response {
  const retry = new URL("/sign-in", request.url);
  if (officerId) retry.searchParams.set("officer", officerId);
  retry.searchParams.set("problem", problem);
  return Response.redirect(retry, 303);
}

export async function POST(request: NextRequest): Promise<Response> {
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
  const officer = findOfficer(roster, officerId);
  if (!officer) return backToForm(request, officerId, "rejected");

  // The sign-in route is publicly reachable, but its signed officer cookie is
  // trusted by the shared app gate. Name selection must not bypass that gate.
  const sharedPassphrase = requiredPassphrase(process.env);
  if (sharedPassphrase) {
    const sharedCookie = request.cookies.get(COOKIE_NAME)?.value ?? "";
    const sharedAccess = sharedCookie && matches(sharedCookie, await digest(sharedPassphrase));
    const existingId = sharedAccess
      ? null
      : await readSession(request.cookies.get(OFFICER_COOKIE)?.value, rosterRaw);
    const existingOfficer = existingId ? findOfficer(roster, existingId) : null;
    if (!sharedAccess && !existingOfficer) {
      const returnTo = new URL("/sign-in", request.url);
      returnTo.searchParams.set("officer", officer.id);
      const unlock = new URL("/unlock", request.url);
      unlock.searchParams.set("next", `${returnTo.pathname}${returnTo.search}`);
      return Response.redirect(unlock, 303);
    }
  }

  const response = new Response(null, {
    status: 303,
    headers: { Location: new URL("/officer", request.url).toString() },
  });
  response.headers.append("Set-Cookie", sessionCookie(await issueSession(officer.id, rosterRaw)));
  return response;
}
