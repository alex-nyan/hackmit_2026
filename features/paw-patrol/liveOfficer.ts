import type { LiveDevice } from "../live-track/types";

/** Existing demo slots P-01 and provisioned accounts unit-01 share a unit number.
 * Resolve only against real published devices; never manufacture a GPS fix. */
export function liveOfficer(id: string, devices: LiveDevice[]): LiveDevice | undefined {
  const slot = /^P-(\d{2})$/.exec(id);
  const candidates = slot ? [`unit-${slot[1]}`, id, `officer-${id}`] : [id];
  return candidates
    .map((sourceId) => devices.find((device) => device.id === sourceId))
    .find(Boolean);
}
