import { describe, expect, it } from "vitest";
import type { IncidentSnapshot, Observation } from "../../../../shared/contracts";
import { liveLocations } from "./LiveMap";

const location = (id: string, time: string, freshness: Observation["freshness"]): Observation => ({
  observation_id: id,
  source_id: "phone-gps",
  subject_id: null,
  kind: "location",
  measured_at: time,
  received_at: time,
  boot_id: "boot-1",
  sequence: 1,
  value: {
    latitude: 42.36,
    longitude: -71.09,
    horizontal_accuracy_m: 20,
    speed_mps: null,
    course_degrees: null,
  },
  provenance: "device_reported",
  freshness,
  freshness_expires_at: new Date(Date.parse(time) + 15_000).toISOString(),
  age_seconds: 0,
  warnings: [],
});
describe("live map evidence", () => {
  it("keeps the newest source fix and marks disconnection stale", () => {
    const snapshot: IncidentSnapshot = {
      schema_version: "2.0",
      incident_id: "case-1",
      revision: 1,
      generated_at: "2026-09-19T20:00:00Z",
      sources: [],
      alerts: [],
      scene_reports: [],
      patients: [],
      handoffs: [],
      observations: [
        location("new", "2026-09-19T20:00:00Z", "fresh"),
        location("old", "2026-09-19T19:00:00Z", "historical"),
      ],
    };
    expect(liveLocations(snapshot, true)).toEqual([
      {
        sourceId: "phone-gps",
        lat: 42.36,
        lng: -71.09,
        accuracy: 20,
        stale: false,
        at: "2026-09-19T20:00:00Z",
      },
    ]);
    expect(liveLocations(snapshot, false)[0].stale).toBe(true);
    expect(liveLocations(snapshot, true, Date.parse("2026-09-19T20:00:16Z"))[0].stale).toBe(true);
  });
});
