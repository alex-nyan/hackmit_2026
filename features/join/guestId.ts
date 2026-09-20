import { isValidToken } from "@/features/camera-triage/frame";

/**
 * The unit id a phone publishes under when nobody has signed in.
 *
 * The roster exists so that two phones cannot publish as the same officer, and
 * that is the right rule for a shift. It is the wrong rule for somebody who has
 * just been handed the QR code: they are not on the roster, they will not be
 * issued a passcode, and a sign-in wall is where they put the phone down.
 *
 * A guest id is the smaller claim that fits them. It says "one phone", not
 * "this person" — and it is deliberately shaped so a reader cannot mistake it
 * for a roster identity: everything published under it is prefixed `guest-`
 * wherever it is displayed.
 */

export const GUEST_PREFIX = "guest-";

/**
 * Deliberately missing 0/O, 1/I/L, 5/S and 8/B. The id is read aloud across a
 * table more often than it is copied, and those are the pairs people mishear.
 */
const ALPHABET = "234679ACDEFGHJKMNPQRTUVWXYZ";
const SUFFIX_LENGTH = 4;

export type RandomBytes = (size: number) => Uint8Array;

const defaultRandom: RandomBytes = (size) => crypto.getRandomValues(new Uint8Array(size));

/**
 * Rejection sampling rather than a modulo.
 *
 * 256 is not a multiple of the alphabet, so folding a byte with `%` would make
 * the first few letters measurably likelier. It costs nothing to discard the
 * bytes that would skew it, and an id that is uniform is one fewer thing to
 * reason about when two guests collide.
 */
const LIMIT = Math.floor(256 / ALPHABET.length) * ALPHABET.length;

export function newGuestId(random: RandomBytes = defaultRandom): string {
  let suffix = "";
  while (suffix.length < SUFFIX_LENGTH) {
    // Ask for what is still missing, plus a margin for the rejected bytes.
    const bytes = random((SUFFIX_LENGTH - suffix.length) * 2);
    for (const byte of bytes) {
      if (byte >= LIMIT) continue;
      suffix += ALPHABET[byte % ALPHABET.length];
      if (suffix.length === SUFFIX_LENGTH) break;
    }
  }
  return `${GUEST_PREFIX}${suffix}`;
}

export function isGuestId(value: string): boolean {
  if (!value.startsWith(GUEST_PREFIX)) return false;
  const suffix = value.slice(GUEST_PREFIX.length);
  if (suffix.length !== SUFFIX_LENGTH) return false;
  return [...suffix].every((character) => ALPHABET.includes(character));
}

/**
 * What a dispatcher sees in the roster.
 *
 * The word "Guest" stays in the label on purpose. A guest unit is drawn on the
 * same map as the rest, and the one thing the map must never imply is that
 * somebody holding a phone for thirty seconds is a unit anybody can task.
 */
export function guestLabel(id: string): string {
  if (!isGuestId(id)) return id;
  return `Guest ${id.slice(GUEST_PREFIX.length)}`;
}

/**
 * A guest id is a source id, and the publish path validates it as one. Proving
 * that here means a generated id can never be rejected at the trust boundary.
 */
export function isPublishableGuestId(value: string): boolean {
  return isGuestId(value) && isValidToken(value);
}
