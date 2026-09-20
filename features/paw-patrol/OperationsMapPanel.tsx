"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { LocateFixed, MapPin, Moon, Sun, WifiOff } from "lucide-react";

import { BuildingPanel } from "../boston-map/BuildingPanel";
import type { BuildingFacts } from "../boston-map/buildingSelection";
import { MAP_FOCUS, type MapFocus, type MapTheme } from "../boston-map/types";
import { LiveTrackPanel, useLiveTrack, type LiveDevice } from "@/features/live-track";
import { OperationsMap } from "./OperationsMap";
import { PEOPLE, personStatus } from "./scenario";
import { reportedSuspects, suspectStatus } from "./suspects";
import type { DemoState } from "./useScenario";
import { vehicleAt } from "./vehicles/vehicleMotion";

/** Stable identity so a poll that finds nothing does not rerun the map effect. */
const EMPTY_DEVICES: LiveDevice[] = [];

export interface OperationsMapPanelProps {
  time: number;
  running: boolean;
  readClock: () => DemoState;
  selectedId: string;
  onSelect: (id: string) => void;
  /**
   * Bumped by a demo reset. Only the camera framing follows it: a person's
   * theme and tracking choices are theirs, not the scenario's to undo.
   */
  resetSignal: number;
}

/**
 * The one map every workspace shows.
 *
 * Dispatch, Officer and Hospital used to differ on whether there was a map at
 * all, so the three roles could not talk about the same picture. This panel is
 * the picture: the same units, the same reported persons of interest, the same
 * legend, wherever it is mounted. Everything it owns below is view state for
 * this screen — what is on the map comes from the shared scenario clock.
 */
export function OperationsMapPanel({
  time,
  running,
  readClock,
  selectedId,
  onSelect,
  resetSignal,
}: OperationsMapPanelProps) {
  const [focus, setFocus] = useState<MapFocus>("mit");
  const [theme, setTheme] = useState<MapTheme>("light");
  const [recenterKey, setRecenterKey] = useState(0);
  const [following, setFollowing] = useState(false);
  /**
   * On, and switchable off.
   *
   * This started off so that nothing reached out to a Traccar server until
   * somebody asked. That reasoning belonged to a tracking server with
   * credentials somewhere else; the positions now come from this deployment's
   * own store, and the dashboard puts a join code on screen inviting people to
   * publish into it. Somebody holding that code has already asked.
   *
   * Leaving it off meant a phone could scan, join, publish — and appear
   * nowhere, because the one switch that would have drawn it is in the map
   * header and nobody knew to press it.
   */
  const [tracking, setTracking] = useState(true);
  const liveTrack = useLiveTrack(tracking);
  const liveDevices = liveTrack.state === "tracking" ? liveTrack.devices : EMPTY_DEVICES;
  const [building, setBuilding] = useState<BuildingFacts | null>(null);
  const handleBuildingSelect = useCallback((next: BuildingFacts | null) => setBuilding(next), []);
  const [fixRequest, setFixRequest] = useState<{
    longitude: number;
    latitude: number;
    nonce: number;
  } | null>(null);

  // The nonce is what makes a repeat click move the camera again.
  const handleFocusDevice = useCallback((device: LiveDevice) => {
    if (!device.fix) return;
    setFollowing(false);
    setFixRequest((previous) => ({
      longitude: device.fix!.longitude,
      latitude: device.fix!.latitude,
      nonce: (previous?.nonce ?? 0) + 1,
    }));
  }, []);

  const lastReset = useRef(resetSignal);
  useEffect(() => {
    if (lastReset.current === resetSignal) return;
    lastReset.current = resetSignal;
    setFollowing(false);
    setFocus("mit");
    setRecenterKey((k) => k + 1);
  }, [resetSignal]);

  const person = PEOPLE.find((p) => p.id === selectedId) ?? PEOPLE[0];
  const vehicle = vehicleAt(person.id, time);
  const suspects = reportedSuspects(time);

  return (
    <section className="map-panel" aria-label="Operations map">
      <div className="map-heading">
        <span>
          <MapPin size={16} />
          Boston &amp; Cambridge
        </span>
        <div className="map-actions">
          <button
            className="follow-control"
            disabled={!vehicle.routeId}
            aria-pressed={following}
            title={
              following
                ? "Stop following. You can also drag the map."
                : "Keep the selected patrol vehicle centred"
            }
            onClick={() => setFollowing((value) => !value)}
          >
            <LocateFixed size={14} aria-hidden="true" />
            {following ? "Stop following" : `Follow ${person.id}`}
          </button>
          <button
            className="icon-control"
            title="Centre selected officer"
            aria-label="Centre selected officer"
            onClick={() => setRecenterKey((k) => k + 1)}
          >
            <LocateFixed size={17} />
          </button>
          <button
            className="icon-control"
            data-on={tracking ? "true" : undefined}
            aria-pressed={tracking}
            title={tracking ? "Stop live tracking" : "Show real tracked units"}
            aria-label={tracking ? "Stop live tracking" : "Show real tracked units"}
            onClick={() => setTracking((value) => !value)}
          >
            {tracking ? <LocateFixed size={17} /> : <WifiOff size={17} />}
          </button>
          <button
            className="icon-control"
            title="Toggle map theme"
            aria-label="Toggle map theme"
            onClick={() => setTheme((t) => (t === "light" ? "dark" : "light"))}
          >
            {theme === "light" ? <Moon size={17} /> : <Sun size={17} />}
          </button>
        </div>
      </div>
      <div className="map-wrapper">
        <OperationsMap
          time={time}
          running={running}
          readClock={readClock}
          selectedId={selectedId}
          onSelect={onSelect}
          focus={focus}
          theme={theme}
          recenterKey={recenterKey}
          following={following}
          onStopFollowing={() => setFollowing(false)}
          liveDevices={liveDevices}
          fixRequest={fixRequest}
          onBuildingSelect={handleBuildingSelect}
        />
        <div className="map-overlay">
          <LiveTrackPanel state={liveTrack} onFocusDevice={handleFocusDevice} />
          <BuildingPanel building={building} onDismiss={() => setBuilding(null)} />
        </div>
        <div className="campus-switch" aria-label="Map area">
          {Object.entries(MAP_FOCUS).map(([key, target]) => (
            <button
              key={key}
              aria-pressed={focus === key}
              onClick={() => {
                setFollowing(false);
                setFocus(key as MapFocus);
              }}
            >
              {target.label}
            </button>
          ))}
        </div>
      </div>
      <div className="vehicle-telemetry" aria-label="Selected unit simulated position">
        <span>
          <strong>{person.id}</strong>{" "}
          {time >= 60 && person.id === "P-01" ? "Transport proxy" : personStatus(person.id, time)}
        </span>
        <span>
          {vehicle.routeId ? `${Math.round(vehicle.speedMps * 3.6)} km/h` : "Route unavailable"}
        </span>
        {vehicle.routeId && (
          <span className="vehicle-coordinates">
            {vehicle.point[1].toFixed(5)}, {vehicle.point[0].toFixed(5)}
          </span>
        )}
      </div>
      {/* Named on the legend rather than left to colour alone. */}
      <div className="map-legend">
        <span>
          <i className="legend-officer" />
          Officers · simulated live position
        </span>
        <span>
          <i className="legend-suspect" />
          {suspects.length
            ? `${suspects.map((s) => s.id).join(", ")} · reported, unverified · ${suspectStatus(suspects[0].id, time)}`
            : "Reported person of interest · none reported yet"}
        </span>
        <span>
          <i className="legend-route" />
          Cached street routes · not navigation
        </span>
      </div>
    </section>
  );
}
