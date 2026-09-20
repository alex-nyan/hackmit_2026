/**
 * Who the officers are, and how one proves they are that officer.
 *
 * Identity here is a roster in the environment rather than a user database:
 * the people on it are known before the shift starts, there are a handful of
 * them, and a demo that needs a migration to add an officer is a demo nobody
 * runs. It is deliberately modest — a passcode is a shared secret, not a
 * credential, and this is not a claim that the person holding it is who the
 * roster says.
 *
 * What it does buy is the thing the free-text unit field could not: two phones
 * cannot silently publish as the same officer, and a frame, a transcript and a
 * position can be attributed to one identity rather than to whatever somebody
 * typed.
 */

import { isValidToken } from "@/features/camera-triage/frame";

export interface Officer {
  /** Doubles as the capture source id, so it must survive that validation. */
  id: string;
  name: string;
  badge: string;
}

interface RosterEntry extends Officer {
  passcode: string;
}

/** What a browser may see. Never the passcode. */
export function publicOfficer({ id, name, badge }: RosterEntry): Officer {
  return { id, name, badge };
}

function isEntry(value: unknown): value is RosterEntry {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.id === "string" &&
    isValidToken(entry.id) &&
    typeof entry.name === "string" &&
    entry.name.trim() !== "" &&
    typeof entry.badge === "string" &&
    typeof entry.passcode === "string" &&
    entry.passcode !== ""
  );
}

/**
 * Reads the roster, dropping anything malformed rather than failing closed.
 *
 * A typo in one entry should cost that officer their sign-in, not lock out
 * the whole shift.
 */
export function parseRoster(raw: string | undefined): RosterEntry[] {
  if (!raw?.trim()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const seen = new Set<string>();
  return parsed.filter(isEntry).filter((entry) => {
    if (seen.has(entry.id)) return false;
    seen.add(entry.id);
    return true;
  });
}

export function readRoster(env: Record<string, string | undefined>): RosterEntry[] {
  return parseRoster(env.PAW_PATROL_OFFICERS);
}

export function findOfficer(roster: RosterEntry[], id: string): RosterEntry | null {
  return roster.find((entry) => entry.id === id) ?? null;
}
