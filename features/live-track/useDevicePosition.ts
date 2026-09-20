"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { toSourceId } from "@/features/camera-triage/frame";

/**
 * Publishes this device's own position while the person asks it to.
 *
 * Opt-in and revocable, and started from a gesture rather than a render: a
 * browser only raises the permission prompt for something a person did, and a
 * page that asks the moment it loads is a page people refuse. The watch is torn
 * down the instant it is stopped.
 *
 * No location history is kept here. Only the latest fix is held, and only so it
 * can be republished while it still describes where this phone is.
 */

const ENDPOINT = "/api/positions";
/** Far slower than the GPS fires; a dashboard polls every five seconds anyway. */
const PUBLISH_MS = 4_000;
/**
 * A fix older than this is not republished. A stationary phone stops firing
 * `watchPosition`, so republishing is what keeps a parked unit green — but a
 * phone whose GPS has died must age to amber rather than sit on its last street
 * corner looking live.
 */
const MAX_REPUBLISH_MS = 90_000;
const METRES_PER_SECOND_TO_KMH = 3.6;

/**
 * Tells the store this unit has left.
 *
 * Fire-and-forget, and `keepalive` on purpose: the most common moment to stop
 * publishing is the one where the page is going away, and an ordinary fetch
 * started during teardown is cancelled with the document. A withdrawal that
 * does not arrive is not worth reporting — the fix ages out on its own, just
 * slower than it should.
 */
function withdraw(sourceId: string): void {
  try {
    void fetch(`${ENDPOINT}?sourceId=${encodeURIComponent(sourceId)}`, {
      method: "DELETE",
      keepalive: true,
      cache: "no-store",
    }).catch(() => undefined);
  } catch {
    // Some browsers throw synchronously on a keepalive fetch during unload.
  }
}

export type DevicePositionState =
  | { state: "idle" }
  | { state: "unsupported"; reason: string }
  | { state: "requesting" }
  | { state: "denied"; reason: string }
  | {
      state: "publishing";
      accuracyMeters: number | null;
      lastFixAt: string | null;
      lastError: string | null;
    };

export interface DevicePositionControls {
  state: DevicePositionState;
  start: () => void;
  stop: () => void;
}

interface Session {
  watchId: number;
  timer: ReturnType<typeof setTimeout> | undefined;
  inFlight: AbortController | undefined;
  /** The newest fix, held only for republishing. Never a track. */
  latest: GeolocationPosition | null;
  /**
   * Whether the store ever accepted a fix from this session. A unit that never
   * got one was never on the map, and withdrawing it would be a request that
   * cannot remove anything.
   */
  published: boolean;
}

function describe(error: GeolocationPositionError): string {
  if (error.code === error.PERMISSION_DENIED)
    return "Location permission was refused. Allow it in the browser's site settings to appear on the map.";
  if (error.code === error.POSITION_UNAVAILABLE)
    return "No position is available. Check that location services are on.";
  return "The device took too long to produce a fix.";
}

function finite(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * What the server said went wrong, in words the person holding the phone can
 * act on.
 *
 * Every refusal from the publish route carries a `reason`. Collapsing them all
 * into "the last position could not be published" is how somebody stands there
 * watching a button that says they are on the map, on a page that cannot tell
 * them the store behind it has been switched off.
 */
async function reasonFrom(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (typeof body === "object" && body !== null) {
      const { reason } = body as { reason?: unknown };
      if (typeof reason === "string" && reason.trim()) return reason;
    }
  } catch {
    // A body that is not JSON says nothing the status has not already said.
  }
  return "The last position could not be published.";
}

export function useDevicePosition(
  sourceId: string,
  /**
   * What a dashboard should call this unit. Defaults to the source id, which
   * is right while somebody is typing their own unit name — but once an
   * officer signs in the id is `unit-01` and their name is not, and a map
   * showing the id would be naming the slot rather than the person in it.
   */
  displayName?: string,
): DevicePositionControls {
  const [state, setState] = useState<DevicePositionState>({ state: "idle" });
  const sessionRef = useRef<Session | null>(null);
  const idRef = useRef(sourceId);
  const nameRef = useRef(displayName ?? sourceId);

  // Renaming a unit mid-session must not tear down the watch and re-prompt for
  // permission, so both are read through refs rather than dependencies.
  useEffect(() => {
    idRef.current = sourceId;
    nameRef.current = displayName ?? sourceId;
  }, [sourceId, displayName]);

  const release = useCallback(() => {
    const session = sessionRef.current;
    if (!session) return;
    sessionRef.current = null;
    navigator.geolocation.clearWatch(session.watchId);
    if (session.timer) clearTimeout(session.timer);
    // Abandon the publish in flight before withdrawing, so the two are not
    // racing to say opposite things about the same unit.
    session.inFlight?.abort();
    session.latest = null;
    // Only for a session that actually published: a unit that never got a fix
    // was never on the map to be taken off it.
    if (session.published) withdraw(toSourceId(idRef.current));
  }, []);

  const stop = useCallback(() => {
    release();
    setState({ state: "idle" });
  }, [release]);

  const start = useCallback(() => {
    if (sessionRef.current) return;

    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setState({
        state: "unsupported",
        reason: "This browser has no Geolocation API, so it cannot report a position.",
      });
      return;
    }

    setState({ state: "requesting" });

    const session: Session = {
      watchId: -1,
      timer: undefined,
      inFlight: undefined,
      latest: null,
      published: false,
    };

    const current = () => sessionRef.current === session;

    const report = (patch: Partial<Extract<DevicePositionState, { state: "publishing" }>>) => {
      if (!current()) return;
      setState((previous) =>
        previous.state === "publishing"
          ? { ...previous, ...patch }
          : {
              state: "publishing",
              accuracyMeters: null,
              lastFixAt: null,
              lastError: null,
              ...patch,
            },
      );
    };

    async function publish() {
      const position = session.latest;
      if (!position || !current()) return;
      // Republish only while the held fix still describes where this phone is.
      if (Date.now() - position.timestamp > MAX_REPUBLISH_MS) return;

      const { coords } = position;
      session.inFlight?.abort();
      const controller = new AbortController();
      session.inFlight = controller;
      const speed = finite(coords.speed);

      try {
        const response = await fetch(ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
          signal: controller.signal,
          body: JSON.stringify({
            sourceId: toSourceId(idRef.current),
            name: nameRef.current,
            longitude: coords.longitude,
            latitude: coords.latitude,
            accuracyMeters: finite(coords.accuracy),
            // The Geolocation API reports metres per second; every other source
            // is normalised to km/h before it reaches a dashboard.
            speedKmh: speed === null ? null : speed * METRES_PER_SECOND_TO_KMH,
            headingDegrees: finite(coords.heading),
            fixedAt: new Date(position.timestamp).toISOString(),
          }),
        });
        if (!response.ok) throw new Error(await reasonFrom(response));
        session.published = true;
        report({ lastError: null });
      } catch (error) {
        if (controller.signal.aborted) return;
        report({
          lastError:
            error instanceof Error && error.message
              ? error.message
              : "The last position could not be published.",
        });
      }
    }

    function tick() {
      void publish().finally(() => {
        if (current()) session.timer = setTimeout(tick, PUBLISH_MS);
      });
    }

    session.watchId = navigator.geolocation.watchPosition(
      (position) => {
        if (!current()) return;
        session.latest = position;
        report({
          accuracyMeters: finite(position.coords.accuracy),
          lastFixAt: new Date(position.timestamp).toISOString(),
        });
      },
      (error) => {
        if (!current()) return;
        // A refusal is terminal for this session and the watch is worthless
        // after it; anything else is transient and `watchPosition` retries.
        if (error.code === error.PERMISSION_DENIED) {
          release();
          setState({ state: "denied", reason: describe(error) });
        } else {
          report({ lastError: describe(error) });
        }
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    );

    sessionRef.current = session;
    session.timer = setTimeout(tick, PUBLISH_MS);
  }, [release]);

  // A page that goes away must not leave a watch running behind it.
  useEffect(() => release, [release]);

  return { state, start, stop };
}
