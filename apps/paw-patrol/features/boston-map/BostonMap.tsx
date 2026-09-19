"use client";

import "mapbox-gl/dist/mapbox-gl.css";

import { useEffect, useRef } from "react";
import type { Map as MapboxMap } from "mapbox-gl";

import styles from "./BostonMap.module.css";
import { MAP_FOCUS, type MapFocus, type MapTheme, type MapStatus } from "./types";
import { add3DBuildings, basemapStyle, isBuildingMapReady } from "./buildingLayer";
import { loadMapbox } from "./mapboxClient";

interface BostonMapProps {
  focus: MapFocus;
  theme: MapTheme;
  onStatusChange: (status: MapStatus) => void;
}

export function BostonMap({ focus, theme, onStatusChange }: BostonMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapboxMap | null>(null);
  const themeRef = useRef(theme);
  const focusRef = useRef(focus);
  const loadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
