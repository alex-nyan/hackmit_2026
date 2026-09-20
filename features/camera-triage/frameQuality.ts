/**
 * How good a frame to send next.
 *
 * The capture loop encoded every frame at one fixed size and quality, which is
 * the right setting for exactly one network. On a good link it was leaving
 * detail on the floor; on a bad one it was spending four seconds uploading a
 * frame that the wall wanted two seconds ago, so the picture fell behind while
 * looking sharp — the worst of both.
 *
 * This is the congestion control a streaming stack would do for us, at the
 * granularity this one actually has. There is no bitrate to steer because
 * there is no video codec: each frame is an independent JPEG, so the only
 * knobs are how large it is and how hard it is compressed, and the only signal
 * is how long the last upload took.
 *
 * Deliberately slow to climb and quick to fall. Sending too much on a link
 * that cannot carry it costs latency on the wall, which is the thing a
 * dispatcher actually notices; sending too little costs detail on a still that
 * a person is about to look at anyway.
 */

export interface Encoding {
  /** Longest edge the frame is scaled down to. Never scales a frame up. */
  width: number;
  /** Canvas JPEG quality, 0 to 1. */
  quality: number;
}

/**
 * Rung 1 is what every frame used to be, so a link that neither speeds up nor
 * slows down behaves exactly as it did before.
 */
export const QUALITY_LADDER: readonly Encoding[] = [
  { width: 1600, quality: 0.82 },
  { width: 1280, quality: 0.72 },
  { width: 960, quality: 0.66 },
  { width: 640, quality: 0.58 },
  { width: 480, quality: 0.5 },
];

const TOP = 0;
const BOTTOM = QUALITY_LADDER.length - 1;
const START = 1;

/**
 * Past this the upload is eating the interval between frames, so the wall is
 * seeing the scene late no matter how good the picture is.
 */
export const SLOW_UPLOAD_MS = 1500;
/** Comfortably inside the interval, with room for a larger frame. */
export const FAST_UPLOAD_MS = 600;
/**
 * Consecutive fast uploads before climbing. One fast frame is as likely to be
 * a lull as a better link, and a ladder that believes it oscillates — which
 * looks worse than either rung, because the picture keeps changing sharpness.
 */
export const FAST_BEFORE_RAISING = 3;

export interface LadderState {
  index: number;
  /** Consecutive fast uploads since the last change. */
  fast: number;
}

export const INITIAL_LADDER: LadderState = { index: START, fast: 0 };

export function encodingAt(state: LadderState): Encoding {
  return QUALITY_LADDER[Math.min(Math.max(state.index, TOP), BOTTOM)];
}

/**
 * The rung to encode the next frame at, given how long the last one took.
 *
 * Only ever called for an upload that completed. A frame the service refused
 * as busy, or one that failed outright, says nothing about how much the link
 * can carry — treating a 429 as congestion would shrink the picture because
 * the model was thinking.
 */
export function afterUpload(state: LadderState, uploadMs: number): LadderState {
  if (!Number.isFinite(uploadMs) || uploadMs < 0) return state;

  if (uploadMs >= SLOW_UPLOAD_MS) {
    // Down immediately, and without credit for whatever came before: the link
    // has just demonstrated what it cannot do.
    return { index: Math.min(state.index + 1, BOTTOM), fast: 0 };
  }

  if (uploadMs > FAST_UPLOAD_MS) {
    // Neither fast nor slow. Hold this rung and forget the run, so a climb
    // needs its evidence unbroken.
    return { index: state.index, fast: 0 };
  }

  const fast = state.fast + 1;
  if (fast < FAST_BEFORE_RAISING || state.index === TOP) return { index: state.index, fast };
  return { index: state.index - 1, fast: 0 };
}

/**
 * How long the link took, with the model's thinking taken back out.
 *
 * The capture posts to a route that waits for the triage service, so the round
 * trip is upload plus inference. Steering on that number would shrink the
 * picture every time the model got slower, which is precisely backwards: a
 * busy model is a reason to send fewer frames, never smaller ones.
 *
 * The service reports what it spent. What is left is the part that moving
 * bytes is responsible for — the Next route's own overhead included, which is
 * small and is on the same side of the wire.
 */
export function linkTimeMs(roundTripMs: number, serverMs: number | undefined): number {
  if (!Number.isFinite(roundTripMs) || roundTripMs < 0) return Number.NaN;
  if (serverMs === undefined || !Number.isFinite(serverMs) || serverMs < 0) return roundTripMs;
  // A server that claims to have spent longer than the whole round trip has a
  // clock disagreement, not a negative link time.
  return Math.max(0, roundTripMs - serverMs);
}

/**
 * What to ask the camera for.
 *
 * The top of the ladder, because a frame is only ever scaled down. Opening the
 * camera at the middle rung would quietly cap the climb: the encoder would ask
 * for 1600 pixels, find 1280, and hold there while reporting otherwise.
 */
export const CAPTURE_REQUEST_WIDTH = QUALITY_LADDER[0].width;
