import { digest } from "./passphrase";

/**
 * The cookie that says which officer this phone is.
 *
 * Signed, because the whole point is that one phone cannot publish as another
 * officer: an unsigned cookie would move the unit-name field from the page
 * into the developer tools and change nothing else.
 *
 * The signing key is derived from the roster itself rather than carried in a
 * separate variable — one less thing for a deployment to forget, and changing
 * the roster ends every session, which is the behaviour you want when an
 * officer is removed from it.
 */

export const OFFICER_COOKIE = "paw-patrol-officer";
/** A shift, not a semester. */
export const OFFICER_COOKIE_MAX_AGE_SECONDS = 12 * 60 * 60;

async function sign(officerId: string, rosterRaw: string): Promise<string> {
  return (await digest(`${rosterRaw}::${officerId}`)).slice(0, 32);
}

export async function issueSession(officerId: string, rosterRaw: string): Promise<string> {
  return `${officerId}.${await sign(officerId, rosterRaw)}`;
}

/**
 * The officer a cookie proves, or null when it proves nothing.
 *
 * Returns the id rather than the roster entry so this stays usable where the
 * roster is not — the proxy only needs to know that somebody signed in.
 */
export async function readSession(
  cookie: string | undefined,
  rosterRaw: string,
): Promise<string | null> {
  if (!cookie) return null;
  const separator = cookie.lastIndexOf(".");
  if (separator <= 0) return null;

  const officerId = cookie.slice(0, separator);
  const presented = cookie.slice(separator + 1);
  const expected = await sign(officerId, rosterRaw);
  if (presented.length !== expected.length) return null;

  // Constant-time so a wrong signature costs the same as a right one.
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= presented.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return difference === 0 ? officerId : null;
}

export function sessionCookie(value: string): string {
  return `${OFFICER_COOKIE}=${value}; Path=/; Max-Age=${OFFICER_COOKIE_MAX_AGE_SECONDS}; HttpOnly; SameSite=Lax; Secure`;
}

export const clearedSessionCookie = `${OFFICER_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Secure`;
