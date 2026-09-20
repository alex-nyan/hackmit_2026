/**
 * A shared passphrase in front of the whole app.
 *
 * Not identity, and not a substitute for it: everyone who is let in is the
 * same anonymous viewer, and the app still says so. It exists because the
 * dashboard shows live cameras and now keeps a rolling history of what they
 * saw, and a guessable URL is a poor thing to have standing between that and
 * the open internet.
 *
 * The cookie carries a digest rather than the passphrase, so a viewer's
 * browser never stores the secret itself and a stolen cookie reveals nothing
 * that can be typed into the form.
 */

export const COOKIE_NAME = "paw-patrol-access";
/** Long enough for a demo, short enough that a borrowed laptop forgets. */
export const COOKIE_MAX_AGE_SECONDS = 12 * 60 * 60;

/** Paths that must stay reachable, or the gate would lock out its own form. */
const ALWAYS_OPEN = [
  "/unlock",
  "/api/unlock",
  "/sign-in",
  "/api/sign-in",
  "/control",
  "/api/instances",
];

export function isOpenPath(pathname: string): boolean {
  return ALWAYS_OPEN.some((open) => pathname === open || pathname.startsWith(`${open}/`));
}

export async function digest(passphrase: string): Promise<string> {
  const bytes = new TextEncoder().encode(`paw-patrol:${passphrase}`);
  const hashed = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hashed)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Compares without returning early, so a wrong guess costs the same either way. */
export function matches(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) {
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return difference === 0;
}

/**
 * The passphrase this deployment expects, or null when it wants none.
 *
 * Unset means open. That is deliberate for local development, where there is
 * no secret to distribute and locking the developer out of their own machine
 * helps nobody — but it does mean a deployment that forgets the variable is
 * open to anyone with the URL, so it is the deployment's job to set it.
 */
export function requiredPassphrase(env: Record<string, string | undefined>): string | null {
  const configured = env.PAW_PATROL_PASSPHRASE?.trim();
  return configured ? configured : null;
}
