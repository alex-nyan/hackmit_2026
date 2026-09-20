export interface CaptureDevice {
  deviceId: string;
  label: string;
  /** Capture devices on one piece of hardware share this, so the iPhone's
   *  camera and microphone arrive as a pair. */
  groupId: string;
}

export interface CaptureDevices {
  cameras: CaptureDevice[];
  microphones: CaptureDevice[];
}

export const NO_DEVICES: CaptureDevices = { cameras: [], microphones: [] };

/**
 * Browsers withhold device labels until capture permission has been granted
 * once, and they withhold them per kind, so an unlabelled list means "ask
 * first", not "no devices".
 */
export function hasLabels(devices: CaptureDevice[]): boolean {
  return devices.some((device) => device.label !== "");
}

export function splitDevices(all: MediaDeviceInfo[]): CaptureDevices {
  const pick = (kind: MediaDeviceKind) =>
    all
      .filter((device) => device.kind === kind && device.deviceId)
      .map((device) => ({
        deviceId: device.deviceId,
        label: device.label,
        groupId: device.groupId,
      }));

  return { cameras: pick("videoinput"), microphones: pick("audioinput") };
}

/** Continuity names a device after the phone: "Alex's iPhone Camera". */
const PHONE_NAME = /iphone|ipad/i;

/**
 * Continuity offers a second, downward-angled lens alongside the real one.
 * It sits in the phone's own group, so every rule below would happily return
 * it; nobody wants a body camera pointed at the desk.
 */
const DESK_VIEW = /desk view/i;

/**
 * Chrome lists the system default input a second time under this id. macOS
 * hands that default to the phone as soon as Continuity connects, which is
 * why the microphone follows the iPhone with nobody asking it to.
 */
const SYSTEM_DEFAULT = "default";

function groupsOf(devices: CaptureDevice[]): Set<string> {
  return new Set(devices.filter((device) => device.groupId).map((device) => device.groupId));
}

function inGroups(devices: CaptureDevice[], groups: Set<string>): CaptureDevice | null {
  return devices.find((device) => device.groupId && groups.has(device.groupId)) ?? null;
}

function namedPhone(devices: CaptureDevice[]): CaptureDevice[] {
  return devices.filter((device) => PHONE_NAME.test(device.label));
}

/**
 * Which camera is the iPhone?
 *
 * Its label is whatever the phone is called, so "Alex's iPhone Camera" is the
 * easy case and a renamed phone is the awkward one: call it "Nyan" and it
 * offers "Nyan Camera", which no amount of matching on "iPhone" will ever
 * find. Two fallbacks cover that, both leaning on the microphone beside it.
 * The camera and microphone of one device share a group, so a phone-named
 * microphone identifies the camera next to it; and failing even that, the
 * group holding the system default microphone is the phone's own, because
 * macOS moves that default to the phone the moment Continuity connects.
 */
export function findPhoneCamera(devices: CaptureDevices): CaptureDevice | null {
  const cameras = devices.cameras.filter((device) => !DESK_VIEW.test(device.label));

  const [byName] = namedPhone(cameras);
  if (byName) return byName;

  const beside = inGroups(cameras, groupsOf(namedPhone(devices.microphones)));
  if (beside) return beside;

  const fallback = devices.microphones.filter((device) => device.deviceId === SYSTEM_DEFAULT);
  return inGroups(cameras, groupsOf(fallback));
}

/** The same question for audio, minus the default-device hint: the default is
 *  the microphone, so it cannot be evidence about itself. */
export function findPhoneMicrophone(devices: CaptureDevices): CaptureDevice | null {
  const [byName] = namedPhone(devices.microphones);
  if (byName) return byName;

  return inGroups(devices.microphones, groupsOf(namedPhone(devices.cameras)));
}

/** An explicit device wins; otherwise let the browser choose. */
export function trackConstraint(deviceId: string | null): MediaTrackConstraints | boolean {
  return deviceId ? { deviceId: { exact: deviceId } } : true;
}
