"use client";

import "mapbox-gl/dist/mapbox-gl.css";
import { useEffect, useRef, useState } from "react";
import { MapPin, RotateCw, TriangleAlert } from "lucide-react";
import type { Map as MapboxMap, Marker, MapMouseEvent } from "mapbox-gl";
import {
  add3DBuildings,
  basemapStyle,
  BUILDING_LAYER_ID,
  clearSelectedBuilding,
  isBuildingMapReady,
  setSelectedBuilding,
} from "../boston-map/buildingLayer";
import { describeBuilding, type BuildingFacts } from "../boston-map/buildingSelection";
import { loadMapbox } from "../boston-map/mapboxClient";
import { MAP_FOCUS, type MapFocus, type MapStatus, type MapTheme } from "../boston-map/types";
import { addLiveLayers, updateLiveLayers, type LiveDevice } from "@/features/live-track";
import { PEOPLE, personStatus } from "./scenario";
import type { DemoState } from "./useScenario";
import { vehicleAt, vehicleRoute } from "./vehicles/vehicleMotion";
import { patrolRouteColor } from "./vehicles/routePresentation";
import { createPatrolCarMarker, patrolCarScreenHeading } from "./vehicles/createPatrolCarMarker";
import styles from "./OperationsMap.module.css";

export interface OperationsMapProps {
  time: number;
  running: boolean;
  readClock: () => DemoState;
  selectedId: string;
  onSelect: (id: string) => void;
  focus: MapFocus;
  theme: MapTheme;
  recenterKey: number;
  following: boolean;
  onStopFollowing: () => void;
  /** Real tracked units from the Traccar bridge; empty when tracking is off. */
  liveDevices: LiveDevice[];
  /** Bumped to fly to a tracked unit, so repeat clicks still move the camera. */
  fixRequest: { longitude: number; latitude: number; nonce: number } | null;
  onBuildingSelect: (building: BuildingFacts | null) => void;
}
type Runtime = {
  updateScene: () => void;
  moveCamera: (officer: boolean) => void;
  setTheme: () => void;
  syncLiveDevices: () => void;
  flyToFix: () => void;
};
type UnitMarker = {
  marker: Marker;
  direction: Marker;
  button: HTMLButtonElement;
  label: HTMLSpanElement;
  dispose: () => void;
};
const LOAD_TIMEOUT_MS = 20000;

export function OperationsMap(props: OperationsMapProps) {
  const { time, running, selectedId, focus, theme, recenterKey, following } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<Runtime | null>(null);
  const latestRef = useRef(props);
  const previousCamera = useRef({ focus, recenterKey, following, selectedId });
  const [attempt, setAttempt] = useState(0);
  const [feedback, setFeedback] = useState({
    status: "loading" as MapStatus,
    message: "Bringing Boston into view…",
  });
  useEffect(() => {
    latestRef.current = props;
  }, [props]);
  useEffect(() => {
    const previous = previousCamera.current;
    if (previous.focus !== focus) runtimeRef.current?.moveCamera(false);
    else if (
      previous.recenterKey !== recenterKey ||
      (following && (!previous.following || previous.selectedId !== selectedId))
    )
      runtimeRef.current?.moveCamera(true);
    previousCamera.current = { focus, recenterKey, following, selectedId };
  }, [focus, recenterKey, following, selectedId]);
  useEffect(() => {
    runtimeRef.current?.updateScene();
  }, [time, running, selectedId, following]);
  useEffect(() => {
    runtimeRef.current?.setTheme();
  }, [theme]);
  // Live fixes arrive on their own poll, independently of the scenario clock.
  useEffect(() => {
    runtimeRef.current?.syncLiveDevices();
  }, [props.liveDevices]);
  useEffect(() => {
    if (props.fixRequest) runtimeRef.current?.flyToFix();
  }, [props.fixRequest]);

  useEffect(() => {
    let disposed = false,
      fatal = false;
    let ownMap: MapboxMap | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let resizeObserver: ResizeObserver | undefined;
    let frameId: number | null = null;
    let lastFrameAt = 0,
      frameTime = latestRef.current.readClock().time;
    let currentTheme = latestRef.current.theme,
      lastLabelStamp = "";
    let selectedBuildingId: string | number | null = null;
    const markers: UnitMarker[] = [],
      cleanups: Array<() => void> = [];
    const preference = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    let reducedMotion = preference?.matches ?? false;
    const clearTimer = () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    };
    const report = (status: MapStatus, message: string) => {
      if (!disposed)
        setFeedback((old) =>
          old.status === status && old.message === message ? old : { status, message },
        );
    };
    const fail = (message: string, permanently = false) => {
      fatal ||= permanently;
      clearTimer();
      report("error", message);
    };
    const ready = () => !!ownMap && !fatal && ownMap.isStyleLoaded() && isBuildingMapReady(ownMap);
    const checkReady = () => {
      if (!disposed && ready()) {
        clearTimer();
        report("ready", "Patrol vehicles ready.");
      }
    };
    const loading = () => {
      clearTimer();
      report("loading", "Bringing Boston into view…");
      timer = setTimeout(() => {
        if (!disposed) {
          if (ready()) checkReady();
          else fail("The map is taking longer than expected. Check your connection and retry.");
        }
      }, LOAD_TIMEOUT_MS);
    };
    async function initialize() {
      const token = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN?.trim();
      if (!token) {
        report(
          "missing-token",
          "Configure a public Mapbox token to see the map. Officer selection and demo controls remain available.",
        );
        return;
      }
      if (!token.startsWith("pk.")) {
        fail("A public Mapbox key is required. Check local configuration.", true);
        return;
      }
      try {
        loading();
        const mapboxgl = await loadMapbox();
        if (disposed || !containerRef.current) return;
        if (!mapboxgl.supported()) {
          fail(
            "WebGL is unavailable. Enable hardware acceleration or use another browser. The officer list remains available.",
            true,
          );
          return;
        }
        const initial = MAP_FOCUS[latestRef.current.focus];
        const map = new mapboxgl.Map({
          container: containerRef.current,
          accessToken: token,
          style: basemapStyle(currentTheme),
          center: initial.center,
          zoom: initial.zoom,
          pitch: latestRef.current.focus === "all" ? 35 : 45,
          bearing: -17.6,
          minZoom: 10.5,
          maxZoom: 19.5,
          projection: "mercator",
          antialias: true,
          attributionControl: true,
        });
        ownMap = map;
        map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), "bottom-right");
        for (const [index, person] of PEOPLE.entries()) {
          const anchor = document.createElement("div");
          anchor.className = styles.markerAnchor;
          const button = document.createElement("button");
          button.type = "button";
          button.className = styles.officerMarker;
          button.dataset.color = person.color;
          button.style.setProperty("--route-color", patrolRouteColor(index));
          const label = document.createElement("span");
          label.className = styles.officerLabel;
          label.textContent = person.id;
          button.append(label);
          anchor.append(button);
          const select = (event: MouseEvent) => {
            event.stopPropagation();
            latestRef.current.onSelect(person.id);
          };
          button.addEventListener("click", select);
          const marker = new mapboxgl.Marker({ element: anchor, anchor: "bottom" })
            .setLngLat(vehicleAt(person.id, frameTime).point)
            .addTo(map);
          const directionElement = createPatrolCarMarker();
          directionElement.className = styles.vehicleDirection;
          directionElement.style.setProperty("--route-color", patrolRouteColor(index));
          const direction = new mapboxgl.Marker({
            element: directionElement,
            anchor: "center",
            rotationAlignment: "viewport",
            // Keep the car's CSS-pixel footprint at every zoom and camera pitch.
            pitchAlignment: "viewport",
          })
            .setLngLat(vehicleAt(person.id, frameTime).point)
            .setRotation(
              patrolCarScreenHeading(
                map,
                vehicleAt(person.id, frameTime).point,
                vehicleAt(person.id, frameTime).heading,
              ),
            )
            .addTo(map);
          anchor.setAttribute("role", "presentation");
          anchor.removeAttribute("aria-label");
          markers.push({
            marker,
            direction,
            button,
            label,
            dispose: () => button.removeEventListener("click", select),
          });
        }
        const draw = (followCamera = true) => {
          if (disposed) return;
          const current = latestRef.current;
          frameTime = current.readClock().time;
          const labelStamp = current.selectedId + ":" + Math.floor(frameTime * 4);
          markers.forEach(({ marker, direction, button, label }, i) => {
            const person = PEOPLE[i],
              selected = person.id === current.selectedId,
              pose = vehicleAt(person.id, frameTime);
            const available = !!vehicleRoute(person.id, frameTime);
            marker.getElement().hidden = !available;
            direction.getElement().hidden = !available;
            if (!available) return;
            marker.setLngLat(pose.point).setOffset([0, -26]);
            direction
              .setLngLat(pose.point)
              .setRotation(patrolCarScreenHeading(map, pose.point, pose.heading));
            direction.getElement().dataset.selected = String(selected);
            direction.getElement().dataset.emergency = String(pose.emergency);
            direction.getElement().style.zIndex = selected ? "3" : "2";
            button.dataset.selected = String(selected);
            button.dataset.emergency = String(pose.emergency);
            marker.getElement().style.zIndex = selected ? "4" : "3";
            if (labelStamp !== lastLabelStamp) {
              const status = personStatus(person.id, frameTime);
              label.textContent = selected ? person.id + " · " + status : person.id;
              button.setAttribute("aria-pressed", String(selected));
              button.setAttribute(
                "aria-label",
                person.name + ", " + person.id + ". " + status + ". Select patrol vehicle.",
              );
              button.title = person.name + " · " + status + " · " + pose.roadName;
            }
          });
          lastLabelStamp = labelStamp;
          if (
            followCamera &&
            current.following &&
            vehicleRoute(current.selectedId, frameTime) &&
            !map.isMoving()
          )
            map.jumpTo({ center: vehicleAt(current.selectedId, frameTime).point });
          map.triggerRepaint();
        };
        // One frame driver; no React state updates per frame. The application
        // and renderer sample the same authoritative continuous scenario clock.
        const frame = (now: number) => {
          frameId = null;
          if (disposed || document.hidden) return;
          if (now - lastFrameAt >= (reducedMotion ? 100 : 1000 / 30)) {
            lastFrameAt = now;
            draw();
          }
          if (latestRef.current.readClock().running) frameId = requestAnimationFrame(frame);
        };
        const updateScene = () => {
          if (disposed) return;
          draw();
          if (!document.hidden && latestRef.current.readClock().running) {
            if (frameId === null) frameId = requestAnimationFrame(frame);
          } else if (frameId !== null) {
            cancelAnimationFrame(frameId);
            frameId = null;
          }
        };
        const moveCamera = (officer: boolean) => {
          const current = latestRef.current,
            area = MAP_FOCUS[current.focus];
          if (officer && !vehicleRoute(current.selectedId, current.readClock().time)) return;
          map.flyTo({
            center: officer
              ? vehicleAt(current.selectedId, current.readClock().time).point
              : area.center,
            zoom: officer ? 18.2 : area.zoom,
            pitch: officer ? 55 : current.focus === "all" ? 35 : 45,
            bearing: -17.6,
            duration: reducedMotion ? 0 : 850,
          });
        };
        const restore = () => {
          if (disposed || fatal) return;
          try {
            add3DBuildings(map, latestRef.current.theme);
            // Feature state does not survive a style change, so drop the
            // highlight rather than leave one the map can no longer draw.
            selectedBuildingId = null;
            latestRef.current.onBuildingSelect(null);
            if (latestRef.current.theme === "dark")
              for (const layer of map.getStyle().layers ?? []) {
                if (layer.type === "symbol" && layer.layout?.["text-field"]) {
                  map.setPaintProperty(layer.id, "text-color", "#fcf7ed");
                  map.setPaintProperty(layer.id, "text-halo-color", "#20263f");
                  map.setPaintProperty(layer.id, "text-halo-width", 1.5);
                }
              }
            // DOM car icons persist across style changes, with no world-scale
            // model underneath them or zoom-dependent representation switch.
            // Live fixes stay above the buildings so they are never buried.
            addLiveLayers(map, latestRef.current.theme);
            updateLiveLayers(map, latestRef.current.liveDevices);
            updateScene();
            checkReady();
          } catch {
            fail("Map layers could not load. Retry the map.", true);
          }
        };
        // Safe before restore() has run: updateLiveLayers no-ops without a source.
        const syncLiveDevices = () => {
          if (!disposed) updateLiveLayers(map, latestRef.current.liveDevices);
        };
        const flyToFix = () => {
          const target = latestRef.current.fixRequest;
          if (disposed || !target) return;
          map.flyTo({
            center: [target.longitude, target.latitude],
            zoom: Math.max(map.getZoom(), 16.5),
            duration: reducedMotion ? 0 : 850,
          });
        };
        runtimeRef.current = {
          updateScene,
          moveCamera,
          syncLiveDevices,
          flyToFix,
          setTheme: () => {
            if (disposed || currentTheme === latestRef.current.theme) return;
            currentTheme = latestRef.current.theme;
            loading();
            try {
              map.setStyle(basemapStyle(currentTheme));
            } catch {
              fail("The selected map appearance could not load. Retry the map.", true);
            }
          },
        };
        // Pick the car's fixed screen-sized footprint using the same continuous
        // position as its marker, independently of zoom or the UI snapshot.
        const nearestUnit = (event: MapMouseEvent) => {
          let id: string | null = null,
            distance = 24;
          for (const person of PEOPLE) {
            if (!vehicleRoute(person.id, frameTime)) continue;
            const p = map.project(vehicleAt(person.id, frameTime).point),
              d = Math.hypot(p.x - event.point.x, p.y - event.point.y);
            if (d < distance) {
              id = person.id;
              distance = d;
            }
          }
          return id;
        };
        const buildingAt = (event: MapMouseEvent) =>
          map.getLayer(BUILDING_LAYER_ID)
            ? map.queryRenderedFeatures(event.point, { layers: [BUILDING_LAYER_ID] })[0]
            : undefined;
        // One handler decides unit, building and dismissal, so the three cannot
        // race the way separate layer and map handlers would. A patrol vehicle
        // always wins the pixel it shares with the building behind it.
        const click = (event: MapMouseEvent) => {
          const id = nearestUnit(event);
          if (id) {
            latestRef.current.onSelect(id);
            return;
          }

          clearSelectedBuilding(map, selectedBuildingId);
          selectedBuildingId = null;

          const facts = describeBuilding(buildingAt(event));
          if (facts?.id != null) {
            selectedBuildingId = facts.id;
            setSelectedBuilding(map, facts.id);
          }
          latestRef.current.onBuildingSelect(facts);
        };
        const hover = (event: MapMouseEvent) => {
          map.getCanvas().style.cursor = nearestUnit(event) || buildingAt(event) ? "pointer" : "";
        };
        const manualMove = (event: { originalEvent?: unknown }) => {
          if (event.originalEvent && latestRef.current.following)
            latestRef.current.onStopFollowing();
        };
        // Reproject headings on zoom, pan, rotation and pitch, even when paused.
        // A camera event must never issue another follow-camera movement.
        const cameraChanged = () => draw(false);
        const visibility = () => {
          if (document.hidden && frameId !== null) {
            cancelAnimationFrame(frameId);
            frameId = null;
          } else if (!document.hidden) updateScene();
        };
        const motionChanged = () => {
          reducedMotion = preference?.matches ?? false;
          updateScene();
        };
        const onError = ({ error }: { error: Error }) => {
          if ("status" in error && (error.status === 401 || error.status === 403))
            fail("Map access was declined. Check the public key configuration.", true);
        };
        const contextLost = () => fail("Map graphics were interrupted. Retry the map.");
        const contextRestored = () => {
          fatal = false;
          loading();
          updateScene();
          checkReady();
        };
        map.on("style.load", restore);
        map.on("idle", checkReady);
        map.on("sourcedata", checkReady);
        map.on("error", onError);
        map.on("click", click);
        map.on("mousemove", hover);
        map.on("movestart", manualMove);
        map.on("move", cameraChanged);
        map.on("webglcontextlost", contextLost);
        map.on("webglcontextrestored", contextRestored);
        document.addEventListener("visibilitychange", visibility);
        preference?.addEventListener("change", motionChanged);
        cleanups.push(() => {
          map.off("style.load", restore);
          map.off("idle", checkReady);
          map.off("sourcedata", checkReady);
          map.off("error", onError);
          map.off("click", click);
          map.off("mousemove", hover);
          map.off("movestart", manualMove);
          map.off("move", cameraChanged);
          map.off("webglcontextlost", contextLost);
          map.off("webglcontextrestored", contextRestored);
          document.removeEventListener("visibilitychange", visibility);
          preference?.removeEventListener("change", motionChanged);
        });
        if (typeof ResizeObserver !== "undefined") {
          resizeObserver = new ResizeObserver(() => {
            if (!disposed) map.resize();
          });
          resizeObserver.observe(containerRef.current);
        }
        if (latestRef.current.following) moveCamera(true);
        updateScene();
        if (map.isStyleLoaded()) restore();
      } catch {
        if (!disposed)
          fail("The interactive map could not start. Check your connection and retry.", true);
      }
    }
    void initialize();
    return () => {
      disposed = true;
      clearTimer();
      if (frameId !== null) cancelAnimationFrame(frameId);
      resizeObserver?.disconnect();
      runtimeRef.current = null;
      cleanups.forEach((cleanup) => cleanup());
      markers.forEach(({ marker, direction, dispose }) => {
        dispose();
        marker.remove();
        direction.remove();
      });
      ownMap?.remove();
    };
  }, [attempt]);

  const hasError = feedback.status === "error" || feedback.status === "missing-token";
  return (
    <div className={styles.root} data-theme={theme}>
      <div
        ref={containerRef}
        className={styles.canvas}
        aria-label="Interactive map of simulated patrol vehicles in Cambridge and Boston"
      />
      {feedback.status !== "ready" && (
        <div
          className={styles.feedback + (hasError ? " " + styles.error : "")}
          role={hasError ? "alert" : "status"}
        >
          <span className={styles.feedbackIcon} aria-hidden="true">
            {hasError ? <TriangleAlert size={21} /> : <MapPin size={21} />}
          </span>
          <div>
            <strong>{hasError ? "Map temporarily unavailable" : "Loading map"}</strong>
            <p>{feedback.message}</p>
            {hasError && (
              <button
                className={styles.retry}
                type="button"
                onClick={() => setAttempt((n) => n + 1)}
              >
                <RotateCw size={14} aria-hidden="true" /> Retry map
              </button>
            )}
          </div>
        </div>
      )}
      <p className={styles.srOnly} aria-live="polite">
        {feedback.status === "ready"
          ? selectedId +
            " selected. " +
            (following
              ? "Following selected unit. Drag the map to stop following."
              : "Free exploration.")
          : ""}
      </p>
    </div>
  );
}
