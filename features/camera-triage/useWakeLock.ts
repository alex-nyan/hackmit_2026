"use client";

import { useEffect } from "react";

/**
 * Holds the screen awake while a capture is running.
 *
 * A phone used as a body camera stops being one the moment its screen sleeps:
 * the page goes hidden, and every capture here releases the camera when that
 * happens. That release is deliberate — a backgrounded tab must not hold a
 * camera — which makes keeping the screen on the only honest way to keep a
 * capture alive.
 *
 * A wake lock does not survive the page being hidden, and browsers do not
 * restore it, so it is dropped and retaken around visibility rather than
 * assumed to persist. Where the API is missing or the request is refused there
 * is nothing to fall back on: the capture ends with the screen, as before.
 */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const lockable = navigator.wakeLock;
    if (!lockable) return;

    let stopped = false;
    let held: WakeLockSentinel | null = null;

    const drop = () => {
      const sentinel = held;
      held = null;
      void sentinel?.release().catch(() => undefined);
    };

    const acquire = async () => {
      if (stopped || held || document.hidden) return;
      try {
        const sentinel = await lockable.request("screen");
        if (stopped || document.hidden) {
          void sentinel.release().catch(() => undefined);
          return;
        }
        held = sentinel;
        // A browser that drops the lock on its own must not leave a stale
        // handle behind, or the next attempt would think one is still held.
        sentinel.addEventListener("release", () => {
          if (held === sentinel) held = null;
        });
      } catch {
        // Refused, or visibility was lost mid-request. Not worth reporting:
        // the capture's own state already says whether the camera is running.
      }
    };

    const onVisibilityChange = () => {
      if (document.hidden) drop();
      else void acquire();
    };

    void acquire();
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      stopped = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      drop();
    };
  }, [active]);
}
