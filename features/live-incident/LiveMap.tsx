"use client";

import "mapbox-gl/dist/mapbox-gl.css";
import { useEffect, useRef, useState } from "react";
import type { Map as MapboxMap, Marker } from "mapbox-gl";
import type { IncidentSnapshot } from "../../shared/contracts";
import { loadMapbox } from "../boston-map/mapboxClient";
import { add3DBuildings, basemapStyle } from "../boston-map/buildingLayer";
import { paintNaturalFeatures } from "../boston-map/naturalPalette";
import { effectiveFreshness } from "./freshness";

export function liveLocations(
  snapshot: IncidentSnapshot,
  connected: boolean,
  serverNow = Date.parse(snapshot.generated_at),
) {
  const latest = new Map<
    string,
    { sourceId: string; lat: number; lng: number; accuracy: number; stale: boolean; at: string }
  >();
  for (const observation of snapshot.observations) {
    if (observation.kind !== "location" || !("latitude" in observation.value)) continue;
    const previous = latest.get(observation.source_id);
    if (previous && Date.parse(previous.at) >= Date.parse(observation.measured_at)) continue;
    latest.set(observation.source_id, {
      sourceId: observation.source_id,
      lat: observation.value.latitude,
      lng: observation.value.longitude,
      accuracy: observation.value.horizontal_accuracy_m,
      at: observation.measured_at,
      stale: effectiveFreshness(observation, connected, serverNow) !== "fresh",
    });
  }
  return [...latest.values()];
}

export function LiveMap({
  snapshot,
  connected,
  serverNow,
}: {
  snapshot: IncidentSnapshot;
  connected: boolean;
  serverNow: number;
}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapboxMap | null>(null);
  const markers = useRef<Marker[]>([]);
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState("Loading map…");
  const latest = useRef({ snapshot, connected });
  useEffect(() => {
    latest.current = { snapshot, connected };
  }, [snapshot, connected]);
  useEffect(() => {
    let disposed = false;
    let resize: ResizeObserver | undefined;
    const token = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN?.trim();
    void (async () => {
      if (!token?.startsWith("pk.")) {
        if (!disposed)
          setMessage(
            "Map unavailable without a public Mapbox token. Phone coordinates remain listed below.",
          );
        return;
      }
      try {
        const runtime = await loadMapbox();
        if (disposed || !container.current) return;
        if (!runtime.supported()) {
          setMessage("Map unavailable on this device. Coordinates remain listed below.");
          return;
        }
        const first = liveLocations(latest.current.snapshot, latest.current.connected)[0];
        const instance = new runtime.Map({
          container: container.current,
          accessToken: token,
          style: basemapStyle("light"),
          center: first ? [first.lng, first.lat] : [-71.0921, 42.3601],
          zoom: 15,
          pitch: 40,
        });
        map.current = instance;
        instance.addControl(new runtime.NavigationControl(), "bottom-right");
        instance.on("load", () => {
          if (!disposed) {
            add3DBuildings(instance, "light");
            paintNaturalFeatures(instance, "light");
            setReady(true);
            setMessage("");
          }
        });
        instance.on("error", () => {
          if (!disposed) setMessage("Map connection degraded. Coordinates remain available below.");
        });
        resize = new ResizeObserver(() => instance.resize());
        resize.observe(container.current);
      } catch {
        if (!disposed) setMessage("Map unavailable. Coordinates remain available below.");
      }
    })();
    return () => {
      disposed = true;
      resize?.disconnect();
      markers.current.forEach((marker) => marker.remove());
      markers.current = [];
      map.current?.remove();
      map.current = null;
    };
  }, []);
  useEffect(() => {
    if (!ready) return;
    let disposed = false;
    void loadMapbox().then((runtime) => {
      if (disposed || !map.current) return;
      markers.current.forEach((marker) => marker.remove());
      markers.current = liveLocations(snapshot, connected, serverNow).map((point) => {
        const node = document.createElement("div");
        node.textContent = `${point.sourceId}${point.stale ? " · stale" : ""}`;
        node.style.cssText = `background:${point.stale ? "#765329" : "#343e8a"};color:white;padding:6px 10px;border:2px solid white;border-radius:8px;font:600 12px Arial;`;
        node.setAttribute(
          "aria-label",
          `${point.sourceId}, phone location, accuracy ${Math.round(point.accuracy)} meters${point.stale ? ", stale" : ""}`,
        );
        return new runtime.Marker({ element: node })
          .setLngLat([point.lng, point.lat])
          .addTo(map.current!);
      });
    });
    return () => {
      disposed = true;
    };
  }, [snapshot, connected, ready, serverNow]);
  return (
    <>
      <div
        ref={container}
        style={{ height: 360, borderRadius: 12, background: "#e4e7e0" }}
        aria-label="Reported phone locations"
      />
      {message && <p role="status">{message}</p>}
      <p>
        Markers show phone fixes, including stale last-known positions. They do not locate a
        detected object or authorize a route.
      </p>
    </>
  );
}
