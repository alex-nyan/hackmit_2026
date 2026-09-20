"use client";

import {
  LoaderCircle,
  LocateFixed,
  LocateOff,
  Moon,
  PawPrint,
  Sun,
  Video,
  VideoOff,
} from "lucide-react";
import { useCallback, useState } from "react";

import { CapturePanel } from "@/features/camera-triage";
import { LiveTrackPanel, useLiveTrack, type LiveDevice } from "@/features/live-track";
import { BostonMap } from "./BostonMap";
import { BuildingPanel } from "./BuildingPanel";
import type { BuildingFacts } from "./buildingSelection";
import { MAP_FOCUS, type MapFocus, type MapTheme, type MapStatus } from "./types";

/** Stable empty array so the map effect does not rerun on every poll. */
const EMPTY_DEVICES: LiveDevice[] = [];

export function BostonMapShell() {
  const [focus, setFocus] = useState<MapFocus>("mit");
  const [theme, setTheme] = useState<MapTheme>("light");
  const [status, setStatus] = useState<MapStatus>("loading");
  // Tracking is opt-in: nothing is requested until the viewer turns it on.
  const [tracking, setTracking] = useState(false);
  const liveTrack = useLiveTrack(tracking);
  const liveDevices = liveTrack.state === "tracking" ? liveTrack.devices : EMPTY_DEVICES;
  const [focusRequest, setFocusRequest] = useState<{
    longitude: number;
    latitude: number;
    nonce: number;
  } | null>(null);

  const handleFocusDevice = useCallback((device: LiveDevice) => {
    if (!device.fix) return;
    setFocusRequest((previous) => ({
      longitude: device.fix!.longitude,
      latitude: device.fix!.latitude,
      nonce: (previous?.nonce ?? 0) + 1,
    }));
  }, []);
  // Capture is opt-in too: no camera or microphone is touched until asked.
  const [capturing, setCapturing] = useState(false);
  const [building, setBuilding] = useState<BuildingFacts | null>(null);
  const handleBuildingSelect = useCallback((next: BuildingFacts | null) => setBuilding(next), []);
  const handleStatusChange = useCallback((nextStatus: MapStatus) => setStatus(nextStatus), []);

  return (
    <main className={`map-app map-app--${theme}`}>
      <header className="map-header">
        <div className="map-brand">
          <PawPrint size={17} strokeWidth={2.2} aria-hidden="true" />
          Paw Patrol
        </div>

        <nav className="area-picker" aria-label="Map area">
          {(Object.keys(MAP_FOCUS) as MapFocus[]).map((area) => (
            <button
              type="button"
              key={area}
              className={focus === area ? "area-picker__button is-active" : "area-picker__button"}
              onClick={() => setFocus(area)}
              aria-pressed={focus === area}
            >
              {MAP_FOCUS[area].label}
            </button>
          ))}
        </nav>

        <div className="map-header__actions">
          <button
            type="button"
            className={capturing ? "icon-button is-active" : "icon-button"}
            onClick={() => setCapturing((current) => !current)}
            aria-pressed={capturing}
            aria-label={capturing ? "Hide the camera panel" : "Show the camera panel"}
            title={capturing ? "Hide the camera panel" : "Show the camera panel"}
          >
            {capturing ? <Video size={17} /> : <VideoOff size={17} />}
          </button>

          <button
            type="button"
            className={tracking ? "icon-button is-active" : "icon-button"}
            onClick={() => setTracking((current) => !current)}
            aria-pressed={tracking}
            aria-label={tracking ? "Stop live tracking" : "Show live locations"}
            title={tracking ? "Stop live tracking" : "Show live locations"}
          >
            {tracking ? <LocateFixed size={17} /> : <LocateOff size={17} />}
          </button>

          <button
            type="button"
            className="icon-button"
            onClick={() => setTheme((current) => (current === "light" ? "dark" : "light"))}
            aria-label={`Switch to ${theme === "light" ? "dark" : "light"} map`}
            title={`Switch to ${theme === "light" ? "dark" : "light"} map`}
          >
            {theme === "light" ? <Moon size={17} /> : <Sun size={17} />}
          </button>
        </div>
      </header>

      <section className="map-stage" aria-label="Boston building map">
        <BostonMap
          focus={focus}
          theme={theme}
          liveDevices={liveDevices}
          focusRequest={focusRequest}
          onStatusChange={handleStatusChange}
          onBuildingSelect={handleBuildingSelect}
        />

        {status === "loading" && (
          <div className="map-status" role="status">
            <LoaderCircle className="map-status__spinner" size={15} />
            Loading map
          </div>
        )}

        {status === "error" && (
          <div className="map-status map-status--error" role="alert">
            The map did not finish loading. Check your connection and Mapbox token, then refresh.
          </div>
        )}

        {status === "missing-token" && (
          <div className="map-config-error" role="alert">
            <strong>Mapbox public token required</strong>
            <p>
              Add <code>NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN</code> to <code>.env.local</code>, then
              restart the local server. See the repository README for setup.
            </p>
          </div>
        )}

        <div className="map-panels">
          {status === "ready" && (
            <LiveTrackPanel state={liveTrack} onFocusDevice={handleFocusDevice} />
          )}
          {capturing && <CapturePanel sourceId="console" />}
          {status === "ready" && (
            <BuildingPanel building={building} onDismiss={() => setBuilding(null)} />
          )}

          {status === "ready" && liveTrack.state === "idle" && !building && (
            <aside className="map-hint">
              <p>Click a building for its height and footprint. Right-drag to tilt and rotate.</p>
            </aside>
          )}
        </div>
      </section>
    </main>
  );
}
