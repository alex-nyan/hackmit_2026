"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { NO_DEVICES, findContinuityDevice, splitDevices, type CaptureDevices } from "./devices";

/** Refresh hot-plugged devices without replacing an explicit user choice. */
export function useCaptureDevices() {
  const [devices, setDevices] = useState<CaptureDevices>(NO_DEVICES);
  // undefined means automatic selection; null is an explicit browser default.
  const [cameraSelection, setCameraId] = useState<string | null | undefined>(undefined);
  const [microphoneSelection, setMicrophoneId] = useState<string | null | undefined>(undefined);
  const mountedRef = useRef(false);
  const refreshRef = useRef(0);

  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const refresh = ++refreshRef.current;
    try {
      const found = splitDevices(await navigator.mediaDevices.enumerateDevices());
      if (!mountedRef.current || refresh !== refreshRef.current) return;
      setDevices(found);
      setCameraId((current) =>
        current && !found.cameras.some((device) => device.deviceId === current) ? null : current,
      );
      setMicrophoneId((current) =>
        current && !found.microphones.some((device) => device.deviceId === current)
          ? null
          : current,
      );
    } catch {
      // Enumeration may be denied independently of capture. Retain the last
      // inventory and let getUserMedia report any acquisition error on Start.
    }
  }, []);

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

  return {
    devices,
    cameraId:
      cameraSelection === undefined
        ? (findContinuityDevice(devices.cameras)?.deviceId ?? null)
        : cameraSelection,
    microphoneId:
      microphoneSelection === undefined
        ? (findContinuityDevice(devices.microphones)?.deviceId ?? null)
        : microphoneSelection,
    setCameraId,
    setMicrophoneId,
    refreshDevices,
  };
}
