import { describe, expect, it } from "vitest";

import {
  FAST_BEFORE_RAISING,
  FAST_UPLOAD_MS,
  INITIAL_LADDER,
  QUALITY_LADDER,
  SLOW_UPLOAD_MS,
  afterUpload,
  encodingAt,
  linkTimeMs,
  type LadderState,
} from "./frameQuality";

const FAST = FAST_UPLOAD_MS - 100;
const SLOW = SLOW_UPLOAD_MS + 100;
const MIDDLING = (FAST_UPLOAD_MS + SLOW_UPLOAD_MS) / 2;

function after(state: LadderState, ...uploads: number[]): LadderState {
  return uploads.reduce(afterUpload, state);
}

describe("the ladder itself", () => {
  it("runs from largest to smallest, so an index is a direction", () => {
    const widths = QUALITY_LADDER.map((rung) => rung.width);
    expect(widths).toEqual([...widths].sort((a, b) => b - a));
  });

  it("lowers quality as it lowers size, rather than trading one for the other", () => {
    const qualities = QUALITY_LADDER.map((rung) => rung.quality);
    expect(qualities).toEqual([...qualities].sort((a, b) => b - a));
  });

  it("starts where the capture loop already was, so an unchanging link is unchanged", () => {
    expect(encodingAt(INITIAL_LADDER)).toEqual({ width: 1280, quality: 0.72 });
  });
});

describe("a link that cannot keep up", () => {
  it("drops a rung on the first slow upload, without waiting for a pattern", () => {
    expect(after(INITIAL_LADDER, SLOW).index).toBe(INITIAL_LADDER.index + 1);
  });

  it("keeps dropping, and stops at the smallest rung rather than off the end", () => {
    const floored = after(INITIAL_LADDER, ...Array<number>(20).fill(SLOW));
    expect(floored.index).toBe(QUALITY_LADDER.length - 1);
    expect(encodingAt(floored)).toEqual(QUALITY_LADDER[QUALITY_LADDER.length - 1]);
  });

  it("forfeits a run of fast uploads, so a climb cannot resume mid-way", () => {
    const nearlyClimbing = after(INITIAL_LADDER, FAST, FAST);
    expect(nearlyClimbing.fast).toBe(2);
    expect(after(nearlyClimbing, SLOW).fast).toBe(0);
  });
});

describe("a link with room to spare", () => {
  it("does not climb on a single fast upload", () => {
    expect(after(INITIAL_LADDER, FAST).index).toBe(INITIAL_LADDER.index);
  });

  it("climbs once the run is long enough", () => {
    const climbed = after(INITIAL_LADDER, ...Array<number>(FAST_BEFORE_RAISING).fill(FAST));
    expect(climbed.index).toBe(INITIAL_LADDER.index - 1);
  });

  it("starts the next run from scratch after climbing", () => {
    const climbed = after(INITIAL_LADDER, ...Array<number>(FAST_BEFORE_RAISING).fill(FAST));
    expect(climbed.fast).toBe(0);
  });

  it("stops at the largest rung instead of climbing off the end", () => {
    const topped = after(INITIAL_LADDER, ...Array<number>(40).fill(FAST));
    expect(topped.index).toBe(0);
    expect(encodingAt(topped)).toEqual(QUALITY_LADDER[0]);
  });
});

describe("a link that is merely adequate", () => {
  it("holds its rung rather than drifting in either direction", () => {
    const held = after(INITIAL_LADDER, ...Array<number>(10).fill(MIDDLING));
    expect(held.index).toBe(INITIAL_LADDER.index);
  });

  it("breaks a run of fast uploads, so climbing needs unbroken evidence", () => {
    const broken = after(INITIAL_LADDER, FAST, FAST, MIDDLING, FAST, FAST);
    expect(broken.index).toBe(INITIAL_LADDER.index);
  });
});

describe("measurements that are not measurements", () => {
  it("ignores a negative or non-finite duration rather than acting on it", () => {
    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(afterUpload(INITIAL_LADDER, bad)).toEqual(INITIAL_LADDER);
    }
  });

  it("treats an instant upload as fast rather than as a broken reading", () => {
    expect(afterUpload(INITIAL_LADDER, 0).fast).toBe(1);
  });
});

describe("separating the link from the model", () => {
  it("removes what the service says it spent", () => {
    expect(linkTimeMs(2000, 1700)).toBe(300);
  });

  it("keeps the whole round trip when the service reported nothing", () => {
    expect(linkTimeMs(800, undefined)).toBe(800);
  });

  it("does not let a slow model shrink the picture", () => {
    // Four seconds of inference behind a fast upload must not read as congestion.
    const ladder = afterUpload(INITIAL_LADDER, linkTimeMs(4200, 4000));
    expect(ladder.index).toBe(INITIAL_LADDER.index);
    expect(ladder.fast).toBe(1);
  });

  it("still sees real congestion underneath a slow model", () => {
    expect(afterUpload(INITIAL_LADDER, linkTimeMs(6000, 4000)).index).toBe(
      INITIAL_LADDER.index + 1,
    );
  });

  it("treats a server claiming more time than the round trip as zero, not negative", () => {
    expect(linkTimeMs(500, 900)).toBe(0);
  });

  it("refuses to read a round trip that is not a duration", () => {
    expect(Number.isNaN(linkTimeMs(Number.NaN, 10))).toBe(true);
  });
});
