"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  NO_DEVICES,
  findPhoneCamera,
  findPhoneMicrophone,
  hasLabels,
  splitDevices,
  type CaptureDevice,
  type CaptureDevices,
} from "./devices";

/** undefined means automatic selection; null is an explicit browser default. */
type Selection = string | null | undefined;

function resolveAll(
  camera: Selection,
  microphone: Selection,
  found: CaptureDevices,
): { cameraId: string | null; microphoneId: string | null } {
  return {
    cameraId: camera === undefined ? (findPhoneCamera(found)?.deviceId ?? null) : camera,
    microphoneId:
      microphone === undefined ? (findPhoneMicrophone(found)?.deviceId ?? null) : microphone,
  };
}

/** Refresh hot-plugged devices without replacing an explicit user choice. */
export function useCaptureDevices() {
  const [devices, setDevices] = useState<CaptureDevices>(NO_DEVICES);
  const [cameraSelection, setCameraId] = useState<Selection>(undefined);
  const [microphoneSelection, setMicrophoneId] = useState<Selection>(undefined);
  const mountedRef = useRef(false);
  const refreshRef = useRef(0);

  const refreshDevices = useCallback(async (): Promise<CaptureDevices | null> => {
    if (!navigator.mediaDevices?.enumerateDevices) return null;
    const refresh = ++refreshRef.current;
    try {
      const found = splitDevices(await navigator.mediaDevices.enumerateDevices());
      if (!mountedRef.current) return null;
      if (refresh !== refreshRef.current) return found;
      setDevices(found);
      setCameraId((current) =>
        current && !found.cameras.some((device) => device.deviceId === current)
          ? undefined
          : current,
      );
      setMicrophoneId((current) =>
        current && !found.microphones.some((device) => device.deviceId === current)
          ? undefined
          : current,
      );
      return found;
    } catch {
      // Enumeration may be denied independently of capture. Retain the last
      // inventory and let getUserMedia report any acquisition error on Start.
      return null;
    }
  }, []);

  /**
   * Answer "which device should this capture open?" at the moment of the click.
   *
   * A Continuity Camera is only recognisable by name, and names arrive with
   * permission, so on a cold page every camera is anonymous and the automatic
   * choice would land on the laptop's own webcam. Buying the names with a
   * stream that is opened and immediately closed is what lets the iPhone win.
   * Browsers may expose only one anonymous device before permission, even
   * when the iPhone is connected. Do not use the list length as evidence.
   */
  const resolveDevices = useCallback(
    async ({ microphone = false, camera = true } = {}) => {
      let found = (await refreshDevices()) ?? devices;
      // Only worth a prompt where the answer is still open: a kind the
      // operator has already chosen for themselves needs no names.
      const blind = (selection: Selection, available: CaptureDevice[]) =>
        selection === undefined && !hasLabels(available);
      const blindCamera = camera && blind(cameraSelection, found.cameras);
      const blindMicrophone = microphone && blind(microphoneSelection, found.microphones);

      if ((blindCamera || blindMicrophone) && navigator.mediaDevices?.getUserMedia) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            video: blindCamera,
            audio: blindMicrophone,
          });
          stream.getTracks().forEach((track) => track.stop());
          found = (await refreshDevices()) ?? found;
        } catch {
          // Declined, or no such device. The acquisition that follows raises
          // it to the user; guessing from an anonymous list would not help.
        }
      }

      return resolveAll(cameraSelection, microphoneSelection, found);
    },
    [cameraSelection, devices, microphoneSelection, refreshDevices],
  );

  useEffect(() => {
    mountedRef.current = true;
    const mediaDevices = navigator.mediaDevices;
    const onChange = () => void refreshDevices();
    mediaDevices?.addEventListener("devicechange", onChange);
    const initial = setTimeout(onChange, 0);
    return () => {
      mountedRef.current = false;
      refreshRef.current += 1;
      clearTimeout(initial);
      mediaDevices?.removeEventListener("devicechange", onChange);
    };
  }, [refreshDevices]);

  // Automatic until the operator picks for themselves, so an iPhone that
  // connects between captures is chosen without anyone touching the selector.
  const selected = resolveAll(cameraSelection, microphoneSelection, devices);

  return {
    devices,
    cameraId: selected.cameraId,
    microphoneId: selected.microphoneId,
    setCameraId,
    setMicrophoneId,
    refreshDevices,
    resolveDevices,
  };
}
