import { describe, expect, it } from "vitest";

import {
  NO_DEVICES,
  findContinuityDevice,
  hasLabels,
  splitDevices,
  trackConstraint,
} from "./devices";

function info(kind: MediaDeviceKind, deviceId: string, label: string) {
  return { kind, deviceId, label, groupId: "g" } as MediaDeviceInfo;
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
    const unlabelled = splitDevices([info("videoinput", "cam1", "")]);
    expect(hasLabels(unlabelled)).toBe(false);
    expect(hasLabels(splitDevices([info("videoinput", "cam1", "FaceTime")]))).toBe(true);
    expect(hasLabels(NO_DEVICES)).toBe(false);
  });
});

describe("finding the iPhone", () => {
  it("picks a Continuity Camera out of the list", () => {
    const { cameras } = splitDevices([
      info("videoinput", "cam1", "FaceTime HD Camera"),
      info("videoinput", "cam2", "Alex's iPhone Camera"),
    ]);
    expect(findContinuityDevice(cameras)?.deviceId).toBe("cam2");
  });

  it("matches an iPad too, and ignores case", () => {
    const { microphones } = splitDevices([info("audioinput", "mic2", "ALEX'S IPAD MICROPHONE")]);
    expect(findContinuityDevice(microphones)?.deviceId).toBe("mic2");
  });

  it("returns null when only built-in devices are present", () => {
    const { cameras } = splitDevices([info("videoinput", "cam1", "FaceTime HD Camera")]);
    expect(findContinuityDevice(cameras)).toBeNull();
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
