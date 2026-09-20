"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { planDemoAmbulance, sampleDemoAmbulance, type DemoAmbulanceMission } from "./demoAmbulance";
import type { DemoHotspot, DemoHotspotLog } from "./hotspots";
import type { DemoState } from "./useScenario";

interface Props {
  hotspots: DemoHotspot[];
  time: number;
  readClock: () => DemoState;
  enabled: boolean;
}

type AmbulanceState = {
  missions: DemoAmbulanceMission[];
  logs: DemoHotspotLog[];
  message: string;
};

const INITIAL: AmbulanceState = { missions: [], logs: [], message: "" };

/** Entirely local simulation. Scene entry always requires an explicit operator action. */
export function useDemoAmbulances({ hotspots, time, readClock, enabled }: Props) {
  const [state, setState] = useState<AmbulanceState>(INITIAL);
  const current = useRef(state);
  const sequence = useRef(0);
  const previousTime = useRef(time);

  const publish = useCallback((next: AmbulanceState) => {
    current.current = next;
    setState(next);
  }, []);

  const makeLog = useCallback(
    (hotspotId: string, title: string, detail: string): DemoHotspotLog => ({
      id: `demo-ambulance-log-${++sequence.current}`,
      at: new Date().toISOString(),
      hotspotId,
      title,
      detail,
    }),
    [],
  );

  const reconcile = useCallback(
    (previous: AmbulanceState, now: number): AmbulanceState => {
      const reset = now < previousTime.current;
      const liveIds = new Set(
        hotspots.filter((hotspot) => hotspot.resolvedAt === null).map((hotspot) => hotspot.id),
      );
      let changed = false;
      const logs = [...previous.logs];
      let message = previous.message;
      const missions = previous.missions.map((mission): DemoAmbulanceMission => {
        if (mission.status === "cancelled") return mission;
        if (reset || !liveIds.has(mission.hotspotId)) {
          changed = true;
          const at = new Date().toISOString();
          logs.push(
            makeLog(
              mission.hotspotId,
              "Demo ambulance mission cancelled",
              reset
                ? `${mission.stationName}: the demo clock was reset. The simulated mission was cancelled; real dispatch and incident records are unchanged.`
                : `${mission.stationName}: its selected hotspot was resolved or removed. The simulated mission was cancelled and no further engagement is permitted.`,
            ),
          );
          message = reset
            ? "Demo reset cancelled ambulance missions."
            : "Hotspot resolved. Its demo ambulance mission was cancelled.";
          return {
            ...mission,
            status: "cancelled",
            updatedAt: at,
            stoppedAt:
              mission.status === "en-route"
                ? reset
                  ? previousTime.current
                  : now
                : mission.startedAt + mission.duration,
          };
        }
        if (mission.status === "en-route" && now >= mission.startedAt + mission.duration) {
          changed = true;
          logs.push(
            makeLog(
              mission.hotspotId,
              "Demo ambulance staged nearby",
              `${mission.stationName}'s simulated ambulance reached its road staging point. It is holding for an explicit operator engagement decision. Arrival does not imply AI clearance or a safe scene.`,
            ),
          );
          message = "Demo ambulance staged nearby. Explicit operator engagement is required.";
          return { ...mission, status: "staged", updatedAt: new Date().toISOString() };
        }
        return mission;
      });
      previousTime.current = now;
      return changed ? { missions, logs, message } : previous;
    },
    [hotspots, makeLog],
  );

  const dispatchAmbulance = useCallback(
    (hotspotId: string): boolean => {
      if (!enabled) return false;
      const now = readClock().time;
      const previous = reconcile(current.current, now);
      const hotspot = hotspots.find((entry) => entry.id === hotspotId && entry.resolvedAt === null);
      if (!hotspot) {
        publish({
          ...previous,
          message: "Select an active hotspot before requesting a demo ambulance.",
        });
        return false;
      }
      if (
        previous.missions.some(
          (mission) => mission.hotspotId === hotspotId && mission.status !== "cancelled",
        )
      ) {
        publish({
          ...previous,
          message: "This hotspot already has an active demo ambulance mission.",
        });
        return false;
      }
      const busy = previous.missions
        .filter((mission) => mission.status !== "cancelled")
        .map((mission) => mission.stationName);
      const { plan, reason } = planDemoAmbulance(hotspot.point, busy);
      if (!plan) {
        publish({ ...previous, message: reason });
        return false;
      }
      const at = new Date().toISOString();
      const mission: DemoAmbulanceMission = {
        id: `demo-ambulance-${Date.now().toString(36)}-${++sequence.current}`,
        hotspotId,
        hotspotPoint: [...hotspot.point],
        ...plan,
        startedAt: now,
        status: "en-route",
        createdAt: at,
        updatedAt: at,
        engagedAt: null,
      };
      publish({
        missions: [...previous.missions, mission],
        logs: [
          ...previous.logs,
          makeLog(
            hotspotId,
            "Demo ambulance requested",
            `Operator requested a simulated ambulance from ${plan.stationName} for the explicitly selected hotspot. It follows supplied road geometry on an accelerated ${Math.round(plan.duration)}-second demo journey, not a real ETA. It will hold nearby until the operator engages medics. No real ambulance was dispatched.`,
          ),
        ],
        message: `Demo ambulance responding from ${plan.stationName}. Accelerated journey; it will hold nearby.`,
      });
      return true;
    },
    [enabled, hotspots, makeLog, publish, readClock, reconcile],
  );

  const engageMedics = useCallback(
    (missionId: string): boolean => {
      if (!enabled) return false;
      const previous = reconcile(current.current, readClock().time);
      const mission = previous.missions.find((entry) => entry.id === missionId);
      if (!mission || mission.status !== "staged") {
        publish({
          ...previous,
          message: "Only a staged demo ambulance at an active hotspot can be engaged.",
        });
        return false;
      }
      const at = new Date().toISOString();
      publish({
        missions: previous.missions.map((entry) =>
          entry.id === missionId
            ? { ...entry, status: "engaged", engagedAt: at, updatedAt: at }
            : entry,
        ),
        logs: [
          ...previous.logs,
          makeLog(
            mission.hotspotId,
            "Demo medics engaged by operator",
            `The operator explicitly engaged the staged simulated team from ${mission.stationName} for this hotspot. This is a local demonstration, not AI scene clearance, a clinical assessment, or a real EMS command.`,
          ),
        ],
        message: "Demo medics engaged by explicit operator action.",
      });
      return true;
    },
    [enabled, makeLog, publish, readClock, reconcile],
  );

  const holdMedics = useCallback(
    (missionId: string): boolean => {
      if (!enabled) return false;
      const previous = reconcile(current.current, readClock().time);
      const mission = previous.missions.find((entry) => entry.id === missionId);
      if (!mission || mission.status !== "engaged") {
        publish({
          ...previous,
          message: "Only an engaged demo team at an active hotspot can receive this STOP command.",
        });
        return false;
      }
      const at = new Date().toISOString();
      publish({
        missions: previous.missions.map((entry) =>
          entry.id === missionId
            ? { ...entry, status: "staged", engagedAt: null, updatedAt: at }
            : entry,
        ),
        logs: [
          ...previous.logs,
          makeLog(
            mission.hotspotId,
            "Demo medics placed on STOP by operator",
            `The operator revoked engagement for the simulated team from ${mission.stationName} at this hotspot. The team is holding at its demo staging point and needs a new explicit authorization before engagement. No real crew was contacted.`,
          ),
        ],
        message: `STOP sent to the demo team for ${mission.hotspotId}. New authorization is required to engage.`,
      });
      return true;
    },
    [enabled, makeLog, publish, readClock, reconcile],
  );

  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => {
      const previous = current.current;
      const next = reconcile(previous, readClock().time);
      if (next !== previous) publish(next);
    }, 250);
    return () => clearInterval(timer);
  }, [enabled, publish, readClock, reconcile]);

  return {
    missions: state.missions,
    logs: state.logs,
    dispatchAmbulance,
    engageMedics,
    holdMedics,
    message: state.message,
    sampleAmbulance: sampleDemoAmbulance,
  };
}
