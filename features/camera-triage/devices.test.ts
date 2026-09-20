import { describe, expect, it } from "vitest";

import {
  NO_DEVICES,
  findPhoneCamera,
  findPhoneMicrophone,
  hasLabels,
  splitDevices,
  trackConstraint,
} from "./devices";

// Devices on separate hardware are in separate groups, so a group id per
// device is the realistic default and a shared one means "one device".
function info(kind: MediaDeviceKind, deviceId: string, label: string, groupId = deviceId) {
  return { kind, deviceId, label, groupId } as MediaDeviceInfo;
}

describe("splitting devices", () => {
  it("separates cameras from microphones and ignores outputs", () => {
    const devices = splitDevices([
      info("videoinput", "cam1", "FaceTime HD Camera"),
      info("audioinput", "mic1", "MacBook Pro Microphone"),
      info("audiooutput", "out1", "MacBook Pro Speakers"),
    ]);
    expect(devices.cameras.map((d) => d.label)).toEqual(["FaceTime HD Camera"]);
    expect(devices.microphones.map((d) => d.label)).toEqual(["MacBook Pro Microphone"]);
  });

  it("drops entries with no device id, which cannot be selected", () => {
    expect(splitDevices([info("videoinput", "", "Blocked")]).cameras).toEqual([]);
  });
});

describe("labels", () => {
  it("knows unlabelled devices mean permission has not been granted yet", () => {
    expect(hasLabels(splitDevices([info("videoinput", "cam1", "")]).cameras)).toBe(false);
    expect(hasLabels(splitDevices([info("videoinput", "cam1", "FaceTime")]).cameras)).toBe(true);
    expect(hasLabels(NO_DEVICES.cameras)).toBe(false);
  });

  it("reads each kind on its own, because permission is granted per kind", () => {
    const granted = splitDevices([
      info("videoinput", "cam1", "FaceTime HD Camera"),
      info("audioinput", "mic1", ""),
    ]);
    expect(hasLabels(granted.cameras)).toBe(true);
    expect(hasLabels(granted.microphones)).toBe(false);
  });
});

describe("finding the iPhone", () => {
  const macCamera = info("videoinput", "cam1", "FaceTime HD Camera", "mac");
  const macMicrophone = info("audioinput", "mic1", "MacBook Pro Microphone", "mac");

  it("picks a Continuity Camera out of the list by name", () => {
    const found = splitDevices([
      macCamera,
      info("videoinput", "cam2", "Alex's iPhone Camera", "phone"),
    ]);
    expect(findPhoneCamera(found)?.deviceId).toBe("cam2");
  });

  it("matches an iPad too, and ignores case", () => {
    const found = splitDevices([info("audioinput", "mic2", "ALEX'S IPAD MICROPHONE", "pad")]);
    expect(findPhoneMicrophone(found)?.deviceId).toBe("mic2");
  });

  it("pairs a camera and microphone through the device they share", () => {
    const found = splitDevices([
      macCamera,
      info("videoinput", "cam2", "Alex's iPhone Camera", "phone"),
      macMicrophone,
      info("audioinput", "mic2", "Continuity Microphone", "phone"),
    ]);
    expect(findPhoneMicrophone(found)?.deviceId).toBe("mic2");
  });

  it("follows the system default microphone to a phone whose name says nothing", () => {
    // A renamed phone offers "Nyan Camera" and "Nyan Microphone", which no
    // matching on "iPhone" can find. macOS moving the default input onto it
    // is the remaining evidence that the phone is there at all.
    const found = splitDevices([
      macCamera,
      info("videoinput", "cam2", "Nyan Camera", "phone"),
      macMicrophone,
      info("audioinput", "default", "Default - Nyan Microphone", "phone"),
    ]);
    expect(findPhoneCamera(found)?.deviceId).toBe("cam2");
  });

  it("leaves the desk-view lens alone, whichever rule finds the phone", () => {
    const found = splitDevices([
      macCamera,
      info("videoinput", "desk", "Desk View Camera", "phone"),
      info("videoinput", "cam2", "Nyan Camera", "phone"),
      info("audioinput", "default", "Default - Nyan Microphone", "phone"),
    ]);
    expect(findPhoneCamera(found)?.deviceId).toBe("cam2");
  });

  it("stays on the built-in camera when the default microphone is the laptop's", () => {
    const found = splitDevices([
      macCamera,
      macMicrophone,
      info("audioinput", "default", "Default - MacBook Pro Microphone", "mac"),
    ]);
    // The laptop's own camera is what the browser would have chosen anyway.
    expect(findPhoneCamera(found)?.deviceId).toBe("cam1");
  });

  it("returns null when only built-in devices are present", () => {
    expect(findPhoneCamera(splitDevices([macCamera]))).toBeNull();
    expect(findPhoneMicrophone(splitDevices([macCamera, macMicrophone]))).toBeNull();
  });

  it("ignores headphones that carry no camera of their own", () => {
    const found = splitDevices([
      macCamera,
      info("audioinput", "default", "Default - AirPods Pro", "airpods"),
    ]);
    expect(findPhoneCamera(found)).toBeNull();
  });
});

describe("constraints", () => {
  it("pins an explicit device so the browser cannot substitute another", () => {
    expect(trackConstraint("cam2")).toEqual({ deviceId: { exact: "cam2" } });
  });

  it("lets the browser choose when nothing is selected", () => {
    expect(trackConstraint(null)).toBe(true);
  });
});
