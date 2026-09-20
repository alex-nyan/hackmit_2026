import { describe, expect, it } from "vitest";

import { isValidToken } from "@/features/camera-triage/frame";

import {
  GUEST_PREFIX,
  guestLabel,
  isGuestId,
  isPublishableGuestId,
  newGuestId,
  type RandomBytes,
} from "./guestId";

/** Feeds the generator a fixed byte stream, padding with an accepted byte. */
function bytes(...values: number[]): RandomBytes {
  let index = 0;
  return (size) =>
    Uint8Array.from({ length: size }, () => {
      const value = index < values.length ? values[index] : 0;
      index += 1;
      return value;
    });
}

describe("newGuestId", () => {
  it("produces an id the publish route will accept", () => {
    for (let run = 0; run < 200; run += 1) {
      const id = newGuestId();
      expect(isValidToken(id)).toBe(true);
      expect(isGuestId(id)).toBe(true);
    }
  });

  it("starts with the guest prefix so nothing reads as a roster identity", () => {
    expect(newGuestId().startsWith(GUEST_PREFIX)).toBe(true);
  });

  it("does not collide across a demo's worth of phones", () => {
    const ids = new Set(Array.from({ length: 500 }, () => newGuestId()));
    // 27^4 possibilities; 500 draws colliding would mean the generator is not
    // actually drawing from the alphabet it claims to.
    expect(ids.size).toBeGreaterThan(490);
  });

  it("discards the bytes that would bias the alphabet rather than folding them", () => {
    // 255 is above the rejection limit for a 27-letter alphabet; a generator
    // using a plain modulo would accept it and return four of the same letter.
    const id = newGuestId(bytes(255, 0));
    expect(id).toBe(`${GUEST_PREFIX}2222`);
  });

  it("keeps drawing when an entire request is rejected", () => {
    // Eight rejected bytes is the whole first draw. The generator has to ask
    // again rather than return a short id.
    const rejected = Array.from({ length: 8 }, () => 255);
    expect(newGuestId(bytes(...rejected))).toBe(`${GUEST_PREFIX}2222`);
  });
});

describe("isGuestId", () => {
  it("rejects a roster id, a truncated id and a padded one", () => {
    expect(isGuestId("p-01")).toBe(false);
    expect(isGuestId(`${GUEST_PREFIX}22`)).toBe(false);
    expect(isGuestId(`${GUEST_PREFIX}22222`)).toBe(false);
  });

  it("rejects a suffix using the characters the alphabet leaves out", () => {
    // 0/O, 1/I/L, 5/S and 8/B are excluded because the id gets read aloud.
    expect(isGuestId(`${GUEST_PREFIX}0OIL`)).toBe(false);
    expect(isGuestId(`${GUEST_PREFIX}58BS`)).toBe(false);
  });

  it("is case sensitive, because the stored id is what gets published", () => {
    expect(isGuestId(`${GUEST_PREFIX}abcd`)).toBe(false);
  });
});

describe("guestLabel", () => {
  it("keeps the word guest in front of a dispatcher", () => {
    expect(guestLabel(`${GUEST_PREFIX}7K2F`)).toBe("Guest 7K2F");
  });

  it("leaves anything that is not a guest id alone", () => {
    expect(guestLabel("p-01")).toBe("p-01");
  });
});

describe("isPublishableGuestId", () => {
  it("requires both the shape and the source-id pattern", () => {
    expect(isPublishableGuestId(newGuestId())).toBe(true);
    expect(isPublishableGuestId("guest-77 7")).toBe(false);
  });
});
