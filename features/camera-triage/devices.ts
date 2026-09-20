export interface CaptureDevice {
  deviceId: string;
  label: string;
}

export interface CaptureDevices {
  cameras: CaptureDevice[];
  microphones: CaptureDevice[];
}

export const NO_DEVICES: CaptureDevices = { cameras: [], microphones: [] };

/**
 * Browsers withhold device labels until capture permission has been granted
 * once, so an unlabelled list means "ask first", not "no devices".
 */
export function hasLabels(devices: CaptureDevices): boolean {
  return [...devices.cameras, ...devices.microphones].some((device) => device.label !== "");
}

export function splitDevices(all: MediaDeviceInfo[]): CaptureDevices {
  const pick = (kind: MediaDeviceKind) =>
    all
      .filter((device) => device.kind === kind && device.deviceId)
      .map((device) => ({ deviceId: device.deviceId, label: device.label }));

  return { cameras: pick("videoinput"), microphones: pick("audioinput") };
}

/**
 * Continuity Camera exposes the iPhone as an ordinary capture device named
 * after the phone. Finding it by name lets the page preselect it, which
 * matters because the built-in webcam is otherwise the default.
 */
export function findContinuityDevice(devices: CaptureDevice[]): CaptureDevice | null {
  return devices.find((device) => /iphone|ipad/i.test(device.label)) ?? null;
}

/** An explicit device wins; otherwise let the browser choose. */
export function trackConstraint(deviceId: string | null): MediaTrackConstraints | boolean {
  return deviceId ? { deviceId: { exact: deviceId } } : true;
}
