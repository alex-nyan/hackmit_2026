"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  HOTSPOT_MAX_ACTIVE,
  chooseDemoResponders,
  sampleDemoVehicle,
  unitRouteProgress,
  validHotspotPoint,
  type DemoHotspot,
  type DemoHotspotLog,
  type DemoUnitMotions,
} from "./hotspots";
import type { DemoState } from "./useScenario";
import { vehicleAt, type VehiclePoint } from "./vehicles/vehicleMotion";

type HotspotState = {
  hotspots: DemoHotspot[];
  logs: DemoHotspotLog[];
  motions: DemoUnitMotions;
  message: string;
};

const INITIAL_STATE: HotspotState = { hotspots: [], logs: [], motions: {}, message: "" };
const NO_UNAVAILABLE_UNITS: string[] = [];

interface Props {
  time: number;
  readClock: () => DemoState;
  enabled: boolean;
  unavailableIds?: string[];
}

/** Local simulated dispatch only. Nothing is sent to the incident bus or real devices. */
export function useDemoHotspots({
  time,
  readClock,
  enabled,
  unavailableIds = NO_UNAVAILABLE_UNITS,
}: Props) {
  const [state, setState] = useState<HotspotState>(INITIAL_STATE);
  const current = useRef(state);
  const sequence = useRef(0);
  const previousTime = useRef(time);

  const publish = useCallback((next: HotspotState) => {
    current.current = next;
    setState(next);
  }, []);

  const makeLog = useCallback(
    (hotspotId: string, title: string, detail: string): DemoHotspotLog => ({
      id: `demo-hotspot-log-${++sequence.current}`,
      at: new Date().toISOString(),
      title,
      detail,
      hotspotId,
    }),
    [],
  );

  const holdUnavailable = useCallback(
    (previous: HotspotState, now: number): HotspotState => {
      const interrupted = Object.entries(previous.motions).filter(
        ([id, motion]) => motion.response && unavailableIds.includes(id),
      );
      if (!interrupted.length) return previous;
      const motions = { ...previous.motions };
      const logs = [...previous.logs];
      const heldIds = new Set<string>();
      for (const [unitId, motion] of interrupted) {
        const progress = unitRouteProgress(unitId, now, previous.motions);
        if (!progress || !motion.response) continue;
        heldIds.add(unitId);
        motions[unitId] = { baseTime: now, baseDistance: progress.distance, held: true };
        logs.push(
          makeLog(
            motion.response.hotspotId,
            `Demo response interrupted · ${unitId}`,
            `An assistance request or acknowledgement is present for ${unitId}. Its simulated hotspot assignment was removed and the demo car is held at its current road position. Resolving the hotspot will not resume this car. The received report and real devices are unchanged.`,
          ),
        );
      }
      return {
        ...previous,
        motions,
        logs,
        hotspots: previous.hotspots.map((hotspot) =>
          hotspot.resolvedAt === null
            ? { ...hotspot, unitIds: hotspot.unitIds.filter((id) => !heldIds.has(id)) }
            : hotspot,
        ),
        message: `${[...heldIds].join(", ")} demo response held because an assistance report is present.`,
      };
    },
    [makeLog, unavailableIds],
  );

  const place = useCallback(
    (point: VehiclePoint) => {
      if (!enabled || !validHotspotPoint(point)) return;
      const now = readClock().time;
      const previous = holdUnavailable(current.current, now);
      if (
        previous.hotspots.filter((hotspot) => hotspot.resolvedAt === null).length >=
        HOTSPOT_MAX_ACTIVE
      ) {
        publish({
          ...previous,
          message: "Resolve a demo hotspot before adding another (maximum 8 active).",
        });
        return;
      }
      const id = `H-${String(previous.hotspots.length + 1).padStart(2, "0")}`;
      const responders = chooseDemoResponders(point, now, previous.motions, unavailableIds);
      const motions = { ...previous.motions };
      for (const responder of responders) {
        motions[responder.unit.id] = {
          baseTime: now,
          baseDistance: responder.baseDistance,
          response: {
            hotspotId: id,
            travelMeters: responder.travelMeters,
            stagingGapMeters: responder.stagingGapMeters,
            arrivalLogged: false,
          },
        };
      }
      const unitIds = responders.map(({ unit }) => unit.id);
      const hotspot: DemoHotspot = {
        id,
        point: [...point],
        createdAt: Date.now(),
        resolvedAt: null,
        unitIds,
      };
      const placement = makeLog(
        id,
        "Demo hotspot placed",
        `Operator marked a potential incident at ${point[1].toFixed(5)}, ${point[0].toFixed(5)}. This is a local simulation, not a verified crime report.`,
      );
      const assignment = makeLog(
        id,
        unitIds.length ? "Demo units alerted and assigned" : "No demo units available nearby",
        unitIds.length
          ? `${unitIds.join(", ")} assigned from within 1.5 km. Cars follow their existing road loops to a staging point within 250 m of the flag. No real alerts or dispatch commands were sent.`
          : "No free demo unit within 1.5 km has an existing road loop that approaches within 250 m of this flag. No real alerts or dispatch commands were sent.",
      );
      publish({
        hotspots: [...previous.hotspots, hotspot],
        logs: [...previous.logs, placement, assignment],
        motions,
        message: unitIds.length
          ? `Demo hotspot placed. ${unitIds.join(", ")} responding along their patrol roads.`
          : "Demo hotspot placed. No available nearby demo route; choose an area near the patrol cars.",
      });
    },
    [enabled, holdUnavailable, makeLog, publish, readClock, unavailableIds],
  );

  const resolve = useCallback(
    (id: string) => {
      if (!enabled) return;
      const now = readClock().time;
      const previous = holdUnavailable(current.current, now);
      const hotspot = previous.hotspots.find(
        (entry) => entry.id === id && entry.resolvedAt === null,
      );
      if (!hotspot) {
        if (previous !== current.current) publish(previous);
        return;
      }
      const motions = { ...previous.motions };
      for (const unitId of hotspot.unitIds) {
        if (motions[unitId]?.response?.hotspotId !== id) continue;
        const progress = unitRouteProgress(unitId, now, motions);
        if (progress) motions[unitId] = { baseTime: now, baseDistance: progress.distance };
      }
      const resolvedAt = Date.now();
      publish({
        ...previous,
        hotspots: previous.hotspots.map((entry) =>
          entry.id === id ? { ...entry, resolvedAt } : entry,
        ),
        motions,
        logs: [
          ...previous.logs,
          makeLog(
            id,
            "Demo hotspot resolved",
            hotspot.unitIds.length
              ? `Operator resolved this simulated hotspot. ${hotspot.unitIds.join(", ")} resume their patrol loops from their current positions. This does not establish that a real scene is safe.`
              : "Operator resolved this simulated hotspot. No units remain assigned. This does not establish that a real scene is safe.",
          ),
        ],
        message: hotspot.unitIds.length
          ? "Demo hotspot resolved. Assigned units have resumed patrol."
          : "Demo hotspot resolved. No units remain assigned.",
      });
    },
    [enabled, holdUnavailable, makeLog, publish, readClock],
  );

  useEffect(() => {
    if (!enabled) return;
    // Logging is driven by the same demo clock as the map, never by wall-clock travel.
    const timer = setInterval(() => {
      const now = readClock().time;
      let previous = current.current;
      if (now < previousTime.current) {
        const active = previous.hotspots.filter((hotspot) => hotspot.resolvedAt === null);
        const resolvedAt = Date.now();
        publish({
          ...previous,
          motions: {},
          hotspots: previous.hotspots.map((hotspot) =>
            hotspot.resolvedAt === null ? { ...hotspot, resolvedAt } : hotspot,
          ),
          logs: [
            ...previous.logs,
            ...active.map((hotspot) =>
              makeLog(
                hotspot.id,
                "Demo hotspot cleared by reset",
                "The local demo clock was reset. Simulated assignments were cleared; no real incident state was changed.",
              ),
            ),
          ],
          message: active.length
            ? "Demo reset cleared active hotspots and assignments."
            : previous.message,
        });
      } else {
        previous = holdUnavailable(previous, now);
        const arrivals = Object.entries(previous.motions).filter(
          ([id, motion]) =>
            motion.response &&
            !motion.response.arrivalLogged &&
            unitRouteProgress(id, now, previous.motions)?.arrived,
        );
        if (arrivals.length) {
          const motions = { ...previous.motions };
          const logs = [...previous.logs];
          for (const [unitId, motion] of arrivals) {
            const response = motion.response!;
            motions[unitId] = { ...motion, response: { ...response, arrivalLogged: true } };
            logs.push(
              makeLog(
                response.hotspotId,
                `Demo ${unitId} staged near hotspot`,
                `${unitId} stopped on its existing patrol road, approximately ${Math.round(response.stagingGapMeters)} m from the flag, and is awaiting operator resolution. No arrival at a real incident is implied.`,
              ),
            );
          }
          publish({
            ...previous,
            motions,
            logs,
            message: `${arrivals.map(([id]) => id).join(", ")} staged near the demo hotspot.`,
          });
        } else if (previous !== current.current) {
          publish(previous);
        }
      }
      previousTime.current = now;
    }, 250);
    return () => clearInterval(timer);
  }, [enabled, holdUnavailable, makeLog, publish, readClock]);

  const sampleVehicle = useCallback(
    (id: string, at: number) =>
      enabled ? sampleDemoVehicle(id, at, state.motions) : vehicleAt(id, at),
    [enabled, state.motions],
  );
  const unitStatus = useCallback(
    (id: string) => {
      if (!enabled) return null;
      if (state.motions[id]?.held) return "Response held · demo";
      if (!state.motions[id]?.response) return null;
      return unitRouteProgress(id, time, state.motions)?.arrived
        ? "Staged nearby · demo"
        : "Dispatched · demo";
    },
    [enabled, state.motions, time],
  );

  return {
    hotspots: state.hotspots,
    logs: state.logs,
    place,
    resolve,
    sampleVehicle,
    unitStatus,
    message: state.message,
  };
}
