"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";

import { useCameraTriage, type CaptureState } from "@/features/camera-triage";
import { useDevicePosition, type DevicePositionState } from "@/features/live-track";

import styles from "./JoinView.module.css";
import { guestLabel, isGuestId, newGuestId } from "./guestId";

/**
 * What somebody sees after they scan the code.
 *
 * Everything here is in service of one tap. The person holding the phone was
 * handed it thirty seconds ago, is standing up, and has read nothing — so there
 * is no unit name to invent, no sign-in, no camera picker and no settings. They
 * press the button, allow the prompt, and they are on the map.
 *
 * The camera is offered second and separately, because agreeing to be a dot on
 * a map is not agreeing to be a face on a wall.
 */

const STORAGE_KEY = "paw-patrol.guest-id";

/**
 * The same phone keeps the same id across a reload.
 *
 * Without this a refresh publishes under a new id while the old one stays on
 * the map for the full drop-out window, so one person becomes two units — and
 * the dispatcher cannot tell which of them is standing in front of them.
 */
function loadGuestId(): string {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved && isGuestId(saved)) return saved;
  } catch {
    // Private browsing refuses storage. A fresh id per load is worse than
    // reusing one, but it is not a reason to refuse the whole page.
  }

  const created = newGuestId();
  try {
    window.localStorage.setItem(STORAGE_KEY, created);
  } catch {
    // Same: the id works for this page load either way.
  }
  return created;
}

/**
 * Read through `useSyncExternalStore` rather than assigned from an effect.
 *
 * The id has to come from the browser — the server has neither the storage nor
 * the randomness to agree with it — but it never changes afterwards. That is
 * exactly a snapshot with no subscription: `null` on the server, a settled id
 * on the client, and no render where it is briefly the wrong one.
 */
let memoizedGuestId: string | null = null;

function guestIdSnapshot(): string {
  memoizedGuestId ??= loadGuestId();
  return memoizedGuestId;
}

/** Neither value changes for the life of the page, so nothing ever notifies. */
const neverChanges = () => () => {};
const noGuestIdOnServer = () => null;
const secureSnapshot = () => window.isSecureContext;
const assumeSecureOnServer = () => true;

export function JoinView() {
  const unitId = useSyncExternalStore(neverChanges, guestIdSnapshot, noGuestIdOnServer);
  const secure = useSyncExternalStore(neverChanges, secureSnapshot, assumeSecureOnServer);

  if (unitId === null) {
    return (
      <main className={styles.root}>
        <p className={styles.waiting} role="status">
          Preparing…
        </p>
      </main>
    );
  }

  return <JoinSession unitId={unitId} secure={secure} />;
}

/**
 * Split so the hooks below can depend on a settled id. Starting a watch and
 * then renaming the unit it publishes under would leave the first id on the map
 * with nobody behind it.
 */
function JoinSession({ unitId, secure }: { unitId: string; secure: boolean }) {
  const {
    state: positionState,
    start: startPosition,
    stop: stopPosition,
  } = useDevicePosition(unitId);
  const {
    state: cameraState,
    videoRef,
    start: startCamera,
    stop: stopCamera,
  } = useCameraTriage({ sourceId: unitId });

  const live = positionState.state === "publishing";
  const asking = positionState.state === "requesting";
  const sharing = live || asking;
  const filming = cameraState.state === "running" || cameraState.state === "requesting-camera";

  // Leaving the page while publishing would leave a unit on the map that nobody
  // is holding. Both hooks release on unmount; closing the tab unmounts
  // nothing, so the release has to be asked for explicitly.
  useEffect(() => {
    if (!sharing && !filming) return;
    const release = () => {
      stopPosition();
      stopCamera();
    };
    window.addEventListener("pagehide", release);
    return () => window.removeEventListener("pagehide", release);
  }, [sharing, filming, stopPosition, stopCamera]);

  const togglePosition = useCallback(() => {
    if (sharing) stopPosition();
    else startPosition();
  }, [sharing, startPosition, stopPosition]);

  const toggleCamera = useCallback(() => {
    if (filming) stopCamera();
    // The phone picks its own camera here. A device picker is the right tool
    // on the officer's page and the wrong one for somebody who has been
    // holding this for ten seconds.
    else void startCamera(null);
  }, [filming, startCamera, stopCamera]);

  return (
    <main className={styles.root}>
      <header className={styles.header}>
        <p className={styles.eyebrow}>Paw Patrol · live map</p>
        <h1 className={styles.title}>{live ? "You are on the map" : "Join the map"}</h1>
        <p className={styles.unit}>
          Publishing as <strong>{guestLabel(unitId)}</strong>
        </p>
      </header>

      {!secure && (
        <p className={styles.error}>
          This page is not on a secure origin, so the browser will refuse to share a location. Open
          it over HTTPS.
        </p>
      )}

      <div className={styles.stage} data-filming={filming ? "true" : undefined}>
        <video ref={videoRef} className={styles.video} playsInline muted autoPlay />
        {!filming && (
          <p className={styles.stageHint}>
            {live
              ? "Your position is publishing. The camera is still off."
              : "Nothing is being published yet."}
          </p>
        )}
      </div>

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.primary}
          data-stop={sharing ? "true" : undefined}
          disabled={!secure && !sharing}
          onClick={togglePosition}
        >
          {live ? "Take me off the map" : asking ? "Waiting for permission…" : "Put me on the map"}
        </button>

        <button
          type="button"
          className={styles.secondary}
          data-on={filming ? "true" : undefined}
          aria-pressed={filming}
          onClick={toggleCamera}
        >
          {filming ? "Stop my camera" : "Share my camera too"}
        </button>
      </div>

      <Status position={positionState} camera={cameraState} />

      <p className={styles.fineprint}>
        While this is on, this phone publishes where it is to the dashboard running this demo —
        about once every four seconds, and only the latest fix. Nothing keeps a trail of where you
        have been, and stopping removes you. Closing this tab stops it too.
      </p>
    </main>
  );
}

interface Line {
  key: string;
  text: string;
  bad?: boolean;
}

/**
 * Says what each permission is actually doing. Two capture permissions can be
 * in different states at once, so they are reported separately rather than
 * collapsed into one status that would have to pick which is telling the truth.
 */
function Status({ position, camera }: { position: DevicePositionState; camera: CaptureState }) {
  const lines: Line[] = [];

  if (position.state === "requesting") {
    lines.push({ key: "p-ask", text: "Waiting for location permission…" });
  }
  if (position.state === "denied" || position.state === "unsupported") {
    lines.push({ key: "p-no", text: position.reason, bad: true });
  }
  if (position.state === "publishing") {
    lines.push(
      position.lastError
        ? { key: "p-err", text: position.lastError, bad: true }
        : {
            key: "p-ok",
            text: position.lastFixAt
              ? `Position publishing${
                  position.accuracyMeters === null
                    ? ""
                    : ` · accurate to about ${Math.round(position.accuracyMeters)} m`
                }`
              : "Waiting for a first fix…",
          },
    );
  }

  if (camera.state === "requesting-camera") {
    lines.push({ key: "c-ask", text: "Waiting for camera permission…" });
  }
  if (camera.state === "denied" || camera.state === "unsupported") {
    lines.push({ key: "c-no", text: camera.reason, bad: true });
  }
  if (camera.state === "running") {
    lines.push({
      key: "c-ok",
      text: camera.lastError ?? "Camera publishing to the body camera wall",
      bad: Boolean(camera.lastError),
    });
  }

  if (lines.length === 0) return null;

  return (
    <ul className={styles.status} aria-live="polite">
      {lines.map((line) => (
        <li key={line.key} className={line.bad ? styles.bad : undefined}>
          {line.text}
        </li>
      ))}
    </ul>
  );
}
