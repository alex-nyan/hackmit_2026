"use client";

import "mapbox-gl/dist/mapbox-gl.css";

import { useEffect, useRef } from "react";
import type { Map as MapboxMap } from "mapbox-gl";

import {
  LIVE_POINT_LAYER_ID,
  addLiveLayers,
  liveDeviceAt,
  updateLiveLayers,
  type LiveDevice,
} from "@/features/live-track";
import styles from "./BostonMap.module.css";
import { MAP_FOCUS, type MapFocus, type MapTheme, type MapStatus } from "./types";
import {
  BUILDING_LAYER_ID,
  add3DBuildings,
  basemapStyle,
  clearSelectedBuilding,
  isBuildingMapReady,
  setSelectedBuilding,
} from "./buildingLayer";
import { describeBuilding, type BuildingFacts } from "./buildingSelection";
import { paintNaturalFeatures } from "./naturalPalette";
import { loadMapbox } from "./mapboxClient";

interface BostonMapProps {
  focus: MapFocus;
  theme: MapTheme;
  /** Every tracked unit; empty when tracking is off. */
  liveDevices: LiveDevice[];
  /** Bumped to re-centre on a unit, so repeat clicks still move the camera. */
  focusRequest: { longitude: number; latitude: number; nonce: number } | null;
  onStatusChange: (status: MapStatus) => void;
  onBuildingSelect: (building: BuildingFacts | null) => void;
  /** A live unit was opened, or everything was clicked past and none is. */
  onSelectLiveDevice: (deviceId: string | null) => void;
}

export function BostonMap({
  focus,
  theme,
  liveDevices,
  focusRequest,
  onStatusChange,
  onBuildingSelect,
  onSelectLiveDevice,
}: BostonMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapboxMap | null>(null);
  const themeRef = useRef(theme);
  const focusRef = useRef(focus);
  const loadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const liveDevicesRef = useRef<LiveDevice[]>(liveDevices);
  const selectedIdRef = useRef<string | number | null>(null);
  const onBuildingSelectRef = useRef(onBuildingSelect);
  const onSelectLiveDeviceRef = useRef(onSelectLiveDevice);

  useEffect(() => {
    onBuildingSelectRef.current = onBuildingSelect;
  }, [onBuildingSelect]);

  useEffect(() => {
    onSelectLiveDeviceRef.current = onSelectLiveDevice;
  }, [onSelectLiveDevice]);

  useEffect(() => {
    focusRef.current = focus;
    const map = mapRef.current;
    if (!map) return;

    const target = MAP_FOCUS[focus];
    map.flyTo({
      center: target.center,
      zoom: target.zoom,
      pitch: focus === "all" ? 35 : 45,
      bearing: -17.6,
      duration: 900,
    });
  }, [focus]);

  useEffect(() => {
    let cancelled = false;
    let resizeObserver: ResizeObserver | undefined;

    async function initializeMap() {
      if (!containerRef.current || mapRef.current) return;

      const token = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN?.trim();
      if (!token) {
        onStatusChange("missing-token");
        return;
      }

      if (!token.startsWith("pk.")) {
        onStatusChange("error");
        return;
      }

      onStatusChange("loading");

      try {
        const mapboxgl = await loadMapbox();
        if (cancelled || !containerRef.current) return;

        if (!mapboxgl.supported()) {
          onStatusChange("error");
          return;
        }

        const initial = MAP_FOCUS[focusRef.current];
        const map = new mapboxgl.Map({
          accessToken: token,
          container: containerRef.current,
          style: basemapStyle(themeRef.current),
          center: initial.center,
          zoom: initial.zoom,
          pitch: focusRef.current === "all" ? 35 : 45,
          bearing: -17.6,
          minZoom: 10.5,
          maxZoom: 19,
          antialias: true,
        });

        mapRef.current = map;
        map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), "bottom-right");
        map.addControl(new mapboxgl.FullscreenControl(), "bottom-right");

        const handleReady = () => {
          if (cancelled || !isBuildingMapReady(map)) return;
          if (loadTimerRef.current) clearTimeout(loadTimerRef.current);
          onStatusChange("ready");
        };
        const handleStyleLoad = () => {
          if (cancelled) return;
          try {
            add3DBuildings(map, themeRef.current);
            // Colour the river and the parks before anything is drawn over them.
            paintNaturalFeatures(map, themeRef.current);
            // Feature state does not survive a style change; drop the selection
            // rather than leave a highlight the map can no longer render.
            selectedIdRef.current = null;
            onBuildingSelectRef.current(null);
            addLiveLayers(map, themeRef.current);
            updateLiveLayers(map, liveDevicesRef.current);
            handleReady();
          } catch {
            onStatusChange("error");
          }
        };
        map.on("style.load", handleStyleLoad);

        map.on("idle", handleReady);
        map.on("sourcedata", (event) => {
          if (event.sourceId === "composite" && event.isSourceLoaded) handleReady();
        });

        map.on("error", ({ error }) => {
          if (cancelled) return;
          // Do not log resource URLs, which can contain the access token.
          // Tile/network hiccups can recover; authentication failures cannot.
          if ("status" in error && (error.status === 401 || error.status === 403)) {
            if (loadTimerRef.current) clearTimeout(loadTimerRef.current);
            onStatusChange("error");
          }
        });
        loadTimerRef.current = setTimeout(() => {
          if (!cancelled) {
            onStatusChange(isBuildingMapReady(map) ? "ready" : "error");
          }
        }, 20000);

        // One click handler decides both selection and dismissal, so the two
        // cannot race the way separate layer and map handlers would.
        map.on("click", (event) => {
          if (cancelled) return;

          // A live unit wins the pixel it shares with the building behind it:
          // one is scenery and the other is somebody holding a phone.
          const live = liveDeviceAt(map, event.point);
          if (live) {
            onSelectLiveDeviceRef.current(live);
            return;
          }
          // Anything else puts the open unit away, so the card never goes on
          // describing a dot the viewer has clicked past.
          onSelectLiveDeviceRef.current(null);

          if (!map.getLayer(BUILDING_LAYER_ID)) return;

          const [hit] = map.queryRenderedFeatures(event.point, {
            layers: [BUILDING_LAYER_ID],
          });

          clearSelectedBuilding(map, selectedIdRef.current);
          selectedIdRef.current = null;

          if (!hit) {
            onBuildingSelectRef.current(null);
            return;
          }

          const facts = describeBuilding(hit);
          if (facts?.id != null) {
            selectedIdRef.current = facts.id;
            setSelectedBuilding(map, facts.id);
          }
          onBuildingSelectRef.current(facts);
        });

        map.on("mouseenter", BUILDING_LAYER_ID, () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", BUILDING_LAYER_ID, () => {
          map.getCanvas().style.cursor = "";
        });

        map.on("mouseenter", LIVE_POINT_LAYER_ID, () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", LIVE_POINT_LAYER_ID, () => {
          map.getCanvas().style.cursor = "";
        });

        resizeObserver = new ResizeObserver(() => map.resize());
        resizeObserver.observe(containerRef.current);
      } catch {
        if (!cancelled) onStatusChange("error");
      }
    }

    void initializeMap();

    return () => {
      cancelled = true;
      if (loadTimerRef.current) clearTimeout(loadTimerRef.current);
      resizeObserver?.disconnect();
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [onStatusChange]);

  useEffect(() => {
    liveDevicesRef.current = liveDevices;
    const map = mapRef.current;
    if (!map) return;
    updateLiveLayers(map, liveDevices);
  }, [liveDevices]);

  useEffect(() => {
    if (!focusRequest) return;
    const map = mapRef.current;
    if (!map) return;

    map.flyTo({
      center: [focusRequest.longitude, focusRequest.latitude],
      zoom: Math.max(map.getZoom(), 16.5),
      duration: 900,
    });
    // Keyed on the nonce so selecting the same unit twice still re-centres.
  }, [focusRequest]);

  useEffect(() => {
    themeRef.current = theme;
    const map = mapRef.current;
    if (!map) return;

    onStatusChange("loading");
    if (loadTimerRef.current) clearTimeout(loadTimerRef.current);
    loadTimerRef.current = setTimeout(() => {
      onStatusChange(isBuildingMapReady(map) ? "ready" : "error");
    }, 20000);
    map.setStyle(basemapStyle(theme));
  }, [theme, onStatusChange]);

  return (
    <div className={styles.root}>
      <div
        ref={containerRef}
        className={styles.canvas}
        aria-label="Interactive building map of MIT, Harvard, Cambridge, and Boston"
      />
      <p className={styles.srStatus} aria-live="polite">
        Map centered on {MAP_FOCUS[focus].label}.
      </p>
    </div>
  );
}
