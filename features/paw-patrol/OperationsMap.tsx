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
import { paintNaturalFeatures } from "../boston-map/naturalPalette";
import { loadMapbox } from "../boston-map/mapboxClient";
import { MAP_FOCUS, type MapFocus, type MapStatus, type MapTheme } from "../boston-map/types";
import {
  addLiveLayers,
  liveDeviceAt,
  updateLiveLayers,
  type LiveDevice,
} from "@/features/live-track";
import { PEOPLE, personStatus } from "./scenario";
import type { DemoState } from "./useScenario";
import { vehicleAt, vehicleRoute, type VehiclePosition } from "./vehicles/vehicleMotion";
import { createPatrolCarMarker, patrolCarScreenHeading } from "./vehicles/createPatrolCarMarker";
import type { DemoHotspot } from "./hotspots";
import { PixelHotspotFlag, PIXEL_HOTSPOT_FLAG_SVG } from "./PixelHotspotFlag";
import { DEMO_HEALTH_CENTRES, type DemoAmbulanceMission } from "./demoAmbulance";
import { PIXEL_AMBULANCE_SVG } from "./PixelAmbulance";
import type { IncidentEvent } from "./incidents";
import styles from "./OperationsMap.module.css";

export interface OperationsMapProps {
  audioAlerts?: IncidentEvent[];
  onSelectAudioAlert?: (event: IncidentEvent) => void;
  /** Visual-only opt-in; does not recreate the map or change marker motion. */
  appearance?: "default" | "glass";
  time: number;
  running: boolean;
  readClock: () => DemoState;
  selectedId: string;
  onSelect: (id: string) => void;
  focus: MapFocus;
  /** Optional nonce so choosing the same area can restore its overview. */
  areaFocusKey?: number;
  theme: MapTheme;
  recenterKey: number;
  following: boolean;
  onStopFollowing: () => void;
  /** Real tracked units from the Traccar bridge; empty when tracking is off. */
  liveDevices: LiveDevice[];
  /** Bumped to fly to a tracked unit, so repeat clicks still move the camera. */
  fixRequest: { longitude: number; latitude: number; nonce: number } | null;
  /** A live unit was opened, or everything was clicked past and none is. */
  onSelectLiveDevice: (deviceId: string | null) => void;
  onBuildingSelect: (building: BuildingFacts | null) => void;
  /** Command-centre-only simulation; never used for real units or alerts. */
  hotspot?: {
    placing: boolean;
    /** Browser-client coordinates from the command-centre pointer drag. */
    dragPoint?: { x: number; y: number; dropping: boolean } | null;
    hotspots: DemoHotspot[];
    onPlace: (point: [number, number]) => void;
    onCancel: () => void;
    onResolve: (id: string) => void;
    onSelect?: (id: string) => void;
    sampleVehicle: (id: string, time: number) => VehiclePosition;
  };
  /** Local demo transport only. No real facilities, routing, or dispatch. */
  ambulance?: {
    missions: DemoAmbulanceMission[];
    sample: (
      mission: DemoAmbulanceMission,
      time: number,
    ) => { point: [number, number]; heading: number };
    onSelect: (hotspotId: string) => void;
  };
}
/** The pulsing ground light under a unit. Green for officers, red for reports. */
type BeaconMarker = { marker: Marker; element: HTMLDivElement };
type Runtime = {
  updateScene: () => void;
  moveCamera: (officer: boolean) => void;
  setTheme: () => void;
  syncLiveDevices: () => void;
  syncAudioAlerts: () => void;
  flyToFix: () => void;
  syncHotspots: () => void;
  syncHotspotDrag: () => void;
  syncAmbulances: () => void;
  placeHotspotAtCenter: () => void;
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
  const {
    time,
    running,
    selectedId,
    focus,
    areaFocusKey = 0,
    theme,
    recenterKey,
    following,
  } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<Runtime | null>(null);
  const latestRef = useRef(props);
  const previousCamera = useRef({ focus, areaFocusKey, recenterKey, following, selectedId });
  const [attempt, setAttempt] = useState(0);
  const [selectedHotspotId, setSelectedHotspotId] = useState<string | null>(null);
  const hotspotCancelRef = useRef<HTMLButtonElement>(null);
  const hotspotMarkerRef = useRef<HTMLButtonElement | null>(null);
  const [feedback, setFeedback] = useState({
    status: "loading" as MapStatus,
    message: "Bringing Boston into view…",
  });
  useEffect(() => {
    latestRef.current = props;
  }, [props]);
  useEffect(() => {
    const previous = previousCamera.current;
    if (previous.focus !== focus || previous.areaFocusKey !== areaFocusKey)
      runtimeRef.current?.moveCamera(false);
    else if (
      previous.recenterKey !== recenterKey ||
      (following && (!previous.following || previous.selectedId !== selectedId))
    )
      runtimeRef.current?.moveCamera(true);
    previousCamera.current = { focus, areaFocusKey, recenterKey, following, selectedId };
  }, [focus, areaFocusKey, recenterKey, following, selectedId]);
  useEffect(() => {
    runtimeRef.current?.updateScene();
  }, [time, running, selectedId, following]);
  useEffect(() => {
    runtimeRef.current?.setTheme();
  }, [theme]);
  useEffect(() => {
    runtimeRef.current?.syncAudioAlerts();
  }, [props.audioAlerts]);
  // Live fixes arrive on their own poll, independently of the scenario clock.
  useEffect(() => {
    runtimeRef.current?.syncLiveDevices();
  }, [props.liveDevices]);
  useEffect(() => {
    if (props.fixRequest) runtimeRef.current?.flyToFix();
  }, [props.fixRequest]);
  useEffect(() => {
    runtimeRef.current?.syncHotspots();
  }, [props.hotspot]);
  useEffect(() => {
    runtimeRef.current?.syncHotspotDrag();
  }, [props.hotspot?.dragPoint, props.hotspot?.placing]);
  useEffect(() => {
    runtimeRef.current?.syncAmbulances();
  }, [props.ambulance]);
  useEffect(() => {
    if (selectedHotspotId) hotspotCancelRef.current?.focus();
  }, [selectedHotspotId]);
  useEffect(() => {
    if (!props.hotspot?.placing && !selectedHotspotId) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const placing = latestRef.current.hotspot?.placing;
      if (placing) latestRef.current.hotspot?.onCancel();
      setSelectedHotspotId(null);
      if (!placing && selectedHotspotId) hotspotMarkerRef.current?.focus();
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [props.hotspot?.placing, selectedHotspotId]);

  useEffect(() => {
    let disposed = false,
      fatal = false;
    let interactiveReady = false;
    let ownMap: MapboxMap | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let resizeObserver: ResizeObserver | undefined;
    let frameId: number | null = null;
    let hotspotDragFrame: number | null = null;
    let lastFrameAt = 0,
      frameTime = latestRef.current.readClock().time;
    let currentTheme = latestRef.current.theme,
      lastLabelStamp = "";
    let selectedBuildingId: string | number | null = null;
    let wasPlacingHotspot = false;
    let placementCompleted = false;
    const markers: UnitMarker[] = [],
      beacons: BeaconMarker[] = [],
      cleanups: Array<() => void> = [];
    const audioMarkers = new Map<string, { marker: Marker; dispose: () => void }>();
    const hotspotMarkers = new Map<
      string,
      { marker: Marker; glow: Marker; button: HTMLButtonElement; dispose: () => void }
    >();
    const ambulanceMarkers = new Map<
      string,
      {
        marker: Marker;
        labelMarker: Marker;
        button: HTMLButtonElement;
        label: HTMLSpanElement;
        dispose: () => void;
      }
    >();
    const healthCentreMarkers = new Map<string, Marker>();
    const sampleVehicle = (id: string, clock: number) =>
      latestRef.current.hotspot?.sampleVehicle(id, clock) ?? vehicleAt(id, clock);
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
      interactiveReady = false;
      clearTimer();
      report("error", message);
    };
    const ready = () => !!ownMap && !fatal && ownMap.isStyleLoaded() && isBuildingMapReady(ownMap);
    const checkReady = () => {
      if (!disposed && ready()) {
        interactiveReady = true;
        clearTimer();
        report("ready", "Patrol vehicles ready.");
      }
    };
    const loading = () => {
      interactiveReady = false;
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
        // A beacon sits on the ground at the unit's own coordinate, under the
        // car marker rather than instead of it: the car carries heading, the
        // light carries presence and reads at a zoom where the car does not.
        // Colour is the whole point of it — green is an officer, red is a
        // report about someone else.
        const createBeacon = (kind: "officer" | "suspect", point: [number, number]) => {
          const element = document.createElement("div");
          element.className = styles.beacon;
          element.dataset.kind = kind;
          element.setAttribute("aria-hidden", "true");
          for (const delay of ["0s", "-1.1s"]) {
            const ring = document.createElement("i");
            ring.className = styles.beaconRing;
            ring.style.animationDelay = delay;
            element.append(ring);
          }
          return {
            element,
            marker: new mapboxgl.Marker({ element }).setLngLat(point).addTo(map),
          } satisfies BeaconMarker;
        };
        for (const person of PEOPLE) {
          beacons.push(createBeacon("officer", sampleVehicle(person.id, frameTime).point));
          const anchor = document.createElement("div");
          anchor.className = styles.markerAnchor;
          const button = document.createElement("button");
          button.type = "button";
          button.className = styles.officerMarker;
          const label = document.createElement("span");
          label.className = styles.officerLabel;
          label.textContent = person.id;
          button.append(label);
          anchor.append(button);
          const select = (event: MouseEvent) => {
            event.stopPropagation();
            if (latestRef.current.hotspot?.placing) return;
            latestRef.current.onSelect(person.id);
          };
          button.addEventListener("click", select);
          const marker = new mapboxgl.Marker({ element: anchor, anchor: "bottom" })
            .setLngLat(sampleVehicle(person.id, frameTime).point)
            .addTo(map);
          const directionElement = createPatrolCarMarker();
          directionElement.className = styles.vehicleDirection;
          const direction = new mapboxgl.Marker({
            element: directionElement,
            anchor: "center",
            rotationAlignment: "viewport",
            // Keep the car's CSS-pixel footprint at every zoom and camera pitch.
            pitchAlignment: "viewport",
          })
            .setLngLat(sampleVehicle(person.id, frameTime).point)
            .setRotation(
              patrolCarScreenHeading(
                map,
                sampleVehicle(person.id, frameTime).point,
                sampleVehicle(person.id, frameTime).heading,
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
        const drawAmbulances = () => {
          const interaction = latestRef.current.ambulance;
          if (!interaction) return;
          for (const mission of interaction.missions) {
            const item = ambulanceMarkers.get(mission.id);
            if (!item || mission.status === "cancelled") continue;
            const pose = interaction.sample(mission, frameTime);
            item.marker
              .setLngLat(pose.point)
              .setRotation(patrolCarScreenHeading(map, pose.point, pose.heading));
            item.labelMarker.setLngLat(pose.point);
            item.button.dataset.status = mission.status;
            item.label.dataset.status = mission.status;
            const status =
              mission.status === "staged"
                ? "Staged nearby. Holding for human authorisation"
                : mission.status === "engaged"
                  ? "Authorised to engage in the demo"
                  : "En route to nearby staging";
            item.button.setAttribute(
              "aria-label",
              `${mission.id}, demo ambulance for ${mission.hotspotId}. ${status}. Select medical response.`,
            );
            item.button.title = `${mission.id} · ${mission.hotspotId} · ${status} · simulation only`;
            item.label.textContent = `${mission.id} · ${mission.status === "staged" ? "HOLD" : mission.status === "engaged" ? "ENGAGED" : "EN ROUTE"}`;
          }
        };
        const draw = (followCamera = true) => {
          if (disposed) return;
          const current = latestRef.current;
          frameTime = current.readClock().time;
          const labelStamp = current.selectedId + ":" + Math.floor(frameTime * 4);
          markers.forEach(({ marker, direction, button, label }, i) => {
            const person = PEOPLE[i],
              selected = person.id === current.selectedId,
              pose = sampleVehicle(person.id, frameTime);
            const available = !!vehicleRoute(person.id, frameTime);
            const beacon = beacons[i];
            marker.getElement().hidden = !available;
            direction.getElement().hidden = !available;
            beacon.element.hidden = !available;
            if (!available) return;
            marker.setLngLat(pose.point).setOffset([0, -26]);
            direction
              .setLngLat(pose.point)
              .setRotation(patrolCarScreenHeading(map, pose.point, pose.heading));
            direction.getElement().dataset.selected = String(selected);
            direction.getElement().dataset.emergency = String(pose.emergency);
            direction.getElement().style.zIndex = selected ? "3" : "2";
            beacon.marker.setLngLat(pose.point);
            beacon.element.dataset.emergency = String(pose.emergency);
            beacon.element.dataset.selected = String(selected);
            button.dataset.selected = String(selected);
            button.dataset.emergency = String(pose.emergency);
            marker.getElement().style.zIndex = selected ? "4" : "3";
            if (labelStamp !== lastLabelStamp) {
              const responding = current.hotspot?.hotspots.some(
                (item) => item.resolvedAt === null && item.unitIds.includes(person.id),
              );
              const status = responding
                ? pose.speedMps > 0
                  ? "Responding to demo hotspot"
                  : "Staged nearby · demo"
                : personStatus(person.id, frameTime);
              label.textContent = selected ? person.id + " · " + status : person.id;
              button.setAttribute("aria-pressed", String(selected));
              button.setAttribute(
                "aria-label",
                person.name + ", " + person.id + ". " + status + ". Select patrol vehicle.",
              );
              button.title = person.name + " · " + status + " · " + pose.roadName;
            }
          });
          drawAmbulances();
          lastLabelStamp = labelStamp;
          if (
            followCamera &&
            !current.hotspot?.placing &&
            current.following &&
            vehicleRoute(current.selectedId, frameTime) &&
            !map.isMoving()
          )
            map.jumpTo({ center: sampleVehicle(current.selectedId, frameTime).point });
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
              ? sampleVehicle(current.selectedId, current.readClock().time).point
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
            // Colour the river and the parks before anything is drawn over them.
            paintNaturalFeatures(map, latestRef.current.theme);
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
        const syncAudioAlerts = () => {
          if (disposed) return;
          const alerts = latestRef.current.audioAlerts ?? [];
          const ids = new Set(alerts.filter((event) => event.location).map((event) => event.id));
          for (const [id, item] of audioMarkers) {
            if (ids.has(id)) continue;
            item.dispose();
            item.marker.remove();
            audioMarkers.delete(id);
          }
          for (const event of alerts) {
            if (!event.location || audioMarkers.has(event.id)) continue;
            const button = document.createElement("button");
            button.type = "button";
            button.className = styles.audioAlert;
            button.textContent = `! ${event.personId ?? event.source}`;
            button.setAttribute(
              "aria-label",
              `Review unverified audio concern at reporting officer ${event.personId ?? event.source}'s GPS location`,
            );
            button.title = `Officer GPS at ${event.location.fixedAt}; not suspect location`;
            const select = (click: MouseEvent) => {
              click.stopPropagation();
              latestRef.current.onSelectAudioAlert?.(event);
            };
            button.addEventListener("click", select);
            const marker = new mapboxgl.Marker({
              element: button,
              anchor: "bottom",
              offset: [0, -24],
            })
              .setLngLat([event.location.longitude, event.location.latitude])
              .addTo(map);
            audioMarkers.set(event.id, {
              marker,
              dispose: () => button.removeEventListener("click", select),
            });
          }
        };
        const syncLiveDevices = () => {
          if (!disposed) updateLiveLayers(map, latestRef.current.liveDevices);
        };
        const syncAmbulances = () => {
          if (disposed) return;
          const interaction = latestRef.current.ambulance;
          const active =
            interaction?.missions.filter((mission) => mission.status !== "cancelled") ?? [];
          const activeIds = new Set(active.map((mission) => mission.id));
          for (const [id, item] of ambulanceMarkers) {
            if (activeIds.has(id)) continue;
            item.dispose();
            item.marker.remove();
            item.labelMarker.remove();
            ambulanceMarkers.delete(id);
          }
          for (const mission of active) {
            if (ambulanceMarkers.has(mission.id)) continue;
            const pose = interaction!.sample(mission, latestRef.current.readClock().time);
            const button = document.createElement("button");
            button.type = "button";
            button.className = styles.ambulanceMarker;
            button.dataset.ambulanceMarker = mission.id;
            button.dataset.hotspotId = mission.hotspotId;
            button.innerHTML = PIXEL_AMBULANCE_SVG;
            const select = (event: MouseEvent) => {
              event.stopPropagation();
              if (!latestRef.current.hotspot?.placing) {
                setSelectedHotspotId(null);
                latestRef.current.ambulance?.onSelect(mission.hotspotId);
              }
            };
            button.addEventListener("click", select);
            const marker = new mapboxgl.Marker({
              element: button,
              anchor: "center",
              rotationAlignment: "viewport",
              pitchAlignment: "viewport",
            })
              .setLngLat(pose.point)
              .addTo(map);
            button.setAttribute("role", "button");
            const label = document.createElement("span");
            label.className = styles.ambulanceLabel;
            label.setAttribute("aria-hidden", "true");
            const labelMarker = new mapboxgl.Marker({
              element: label,
              anchor: "bottom",
              offset: [0, -34],
            })
              .setLngLat(pose.point)
              .addTo(map);
            ambulanceMarkers.set(mission.id, {
              marker,
              labelMarker,
              button,
              label,
              dispose: () => button.removeEventListener("click", select),
            });
          }
          if (!interaction) {
            healthCentreMarkers.forEach((marker) => marker.remove());
            healthCentreMarkers.clear();
          } else {
            for (const centre of DEMO_HEALTH_CENTRES) {
              if (healthCentreMarkers.has(centre.id)) continue;
              const element = document.createElement("span");
              element.className = styles.healthCentreMarker;
              element.dataset.healthCentre = centre.id;
              element.textContent = "+";
              element.setAttribute(
                "aria-label",
                `${centre.name}. Fictional demo staging base, not a real facility.`,
              );
              element.title = `${centre.name} · fictional demo base`;
              const marker = new mapboxgl.Marker({ element, anchor: "center" })
                .setLngLat(centre.point)
                .addTo(map);
              healthCentreMarkers.set(centre.id, marker);
            }
          }
          updateScene();
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
        const placeHotspot = (point: [number, number]) => {
          const interaction = latestRef.current.hotspot;
          if (!interactiveReady || !interaction?.placing || placementCompleted) return;
          if (!point.every(Number.isFinite) || Math.abs(point[1]) > 85) return;
          placementCompleted = true;
          setSelectedHotspotId(null);
          interaction.onPlace(point);
        };
        let dragClientPoint: { x: number; y: number } | null = null;
        let savedPlacementCamera: { pitch: number; bearing: number } | null = null;
        let topDownUntil = 0;
        let previousDragFrame = 0;
        const mapContainer = map.getContainer();
        const stopEdgePan = () => {
          if (hotspotDragFrame !== null) cancelAnimationFrame(hotspotDragFrame);
          hotspotDragFrame = null;
          previousDragFrame = 0;
        };
        const pointOnMap = (point: { x: number; y: number }) => {
          const rect = map.getCanvas().getBoundingClientRect();
          const x = point.x - rect.left;
          const y = point.y - rect.top;
          if (x < 0 || y < 0 || x > rect.width || y > rect.height) return null;
          const target = document.elementFromPoint(point.x, point.y);
          if (
            !target ||
            !mapContainer.contains(target) ||
            target.closest(".mapboxgl-marker, .mapboxgl-control-container, button, a")
          )
            return null;
          return { x, y, width: rect.width, height: rect.height };
        };
        const enterTopDown = () => {
          if (savedPlacementCamera || !interactiveReady) return;
          savedPlacementCamera = { pitch: map.getPitch(), bearing: map.getBearing() };
          map.stop();
          const duration = reducedMotion ? 0 : 450;
          topDownUntil = performance.now() + duration;
          map.easeTo({ pitch: 0, bearing: 0, duration });
        };
        const finishPlacementCamera = () => {
          stopEdgePan();
          dragClientPoint = null;
          delete mapContainer.dataset.hotspotDragOver;
          if (!savedPlacementCamera || disposed) return;
          const previous = savedPlacementCamera;
          savedPlacementCamera = null;
          // Preserve the area reached through edge-panning, not the old centre.
          map.easeTo({ ...previous, duration: reducedMotion ? 0 : 450 });
        };
        const edgeVelocity = (coordinate: number, size: number) => {
          const margin = Math.min(64, size / 4);
          if (coordinate < margin) return -(1 - coordinate / margin);
          if (coordinate > size - margin) return 1 - (size - coordinate) / margin;
          return 0;
        };
        const edgePanFrame = (now: number) => {
          hotspotDragFrame = null;
          if (
            disposed ||
            document.hidden ||
            !interactiveReady ||
            !latestRef.current.hotspot?.placing ||
            placementCompleted ||
            !dragClientPoint
          ) {
            previousDragFrame = 0;
            return;
          }
          const point = pointOnMap(dragClientPoint);
          if (!point) {
            previousDragFrame = 0;
            delete mapContainer.dataset.hotspotDragOver;
            return;
          }
          const dt = Math.min(32, previousDragFrame ? now - previousDragFrame : 16) / 1000;
          previousDragFrame = now;
          const dx = edgeVelocity(point.x, point.width) * 220 * dt;
          const dy = edgeVelocity(point.y, point.height) * 220 * dt;
          // Let the initial camera tilt finish before panBy cancels its ease.
          if (now >= topDownUntil && (dx || dy)) map.panBy([dx, dy], { duration: 0 });
          hotspotDragFrame = requestAnimationFrame(edgePanFrame);
        };
        const updateDragPoint = (point: { x: number; y: number } | null) => {
          dragClientPoint = point;
          if (!point || !interactiveReady || !pointOnMap(point)) {
            stopEdgePan();
            delete mapContainer.dataset.hotspotDragOver;
            return;
          }
          enterTopDown();
          mapContainer.dataset.hotspotDragOver = "true";
          if (hotspotDragFrame === null) hotspotDragFrame = requestAnimationFrame(edgePanFrame);
        };
        const dropAtClientPoint = (point: { x: number; y: number }) => {
          stopEdgePan();
          if (!interactiveReady || placementCompleted) return false;
          map.resize();
          const pixel = pointOnMap(point);
          if (!pixel) return false;
          const location = map.unproject([pixel.x, pixel.y]);
          placeHotspot([location.lng, location.lat]);
          return placementCompleted;
        };
        const syncHotspotDrag = () => {
          const interaction = latestRef.current.hotspot;
          if (!interaction?.placing || placementCompleted) {
            updateDragPoint(null);
            return;
          }
          const point = interaction.dragPoint;
          if (!point) return;
          if (point.dropping) {
            if (!dropAtClientPoint(point)) {
              placementCompleted = true;
              interaction.onCancel();
            }
            return;
          }
          updateDragPoint(point);
        };
        const syncHotspots = () => {
          if (disposed) return;
          const interaction = latestRef.current.hotspot;
          const active = interaction?.hotspots.filter((item) => item.resolvedAt === null) ?? [];
          const activeIds = new Set(active.map((item) => item.id));
          for (const [id, item] of hotspotMarkers) {
            if (activeIds.has(id)) continue;
            item.dispose();
            item.marker.remove();
            item.glow.remove();
            hotspotMarkers.delete(id);
          }
          for (const item of active) {
            if (hotspotMarkers.has(item.id)) continue;
            const glowElement = document.createElement("div");
            glowElement.className = styles.hotspotGlow;
            glowElement.setAttribute("aria-hidden", "true");
            const glow = new mapboxgl.Marker({
              element: glowElement,
              pitchAlignment: "map",
              rotationAlignment: "map",
            })
              .setLngLat(item.point)
              .addTo(map);
            const button = document.createElement("button");
            button.type = "button";
            button.className = styles.hotspotFlag;
            button.dataset.hotspotMarker = item.id;
            button.setAttribute("aria-label", `Demo hotspot ${item.id}. Open resolve options.`);
            button.setAttribute("aria-haspopup", "dialog");
            button.title = `Demo hotspot ${item.id} · click to resolve`;
            button.innerHTML = PIXEL_HOTSPOT_FLAG_SVG;
            const label = document.createElement("span");
            label.textContent = item.id;
            button.append(label);
            const open = (event: MouseEvent) => {
              event.stopPropagation();
              if (latestRef.current.hotspot?.placing) return;
              hotspotMarkerRef.current = button;
              setSelectedHotspotId(item.id);
              latestRef.current.hotspot?.onSelect?.(item.id);
            };
            button.addEventListener("click", open);
            const marker = new mapboxgl.Marker({
              element: button,
              anchor: "bottom-left",
              offset: [-8, 0],
            })
              .setLngLat(item.point)
              .addTo(map);
            // Mapbox assigns role="img" to its root marker element. Restore
            // this interactive marker's native button semantics afterwards.
            button.setAttribute("role", "button");
            hotspotMarkers.set(item.id, {
              marker,
              glow,
              button,
              dispose: () => button.removeEventListener("click", open),
            });
          }
          if (interaction?.placing && !wasPlacingHotspot) {
            placementCompleted = false;
            clearSelectedBuilding(map, selectedBuildingId);
            selectedBuildingId = null;
            latestRef.current.onBuildingSelect(null);
          }
          if (interaction?.placing && !interaction.dragPoint) enterTopDown();
          if (!interaction?.placing && wasPlacingHotspot) finishPlacementCamera();
          if (interaction?.placing) map.getCanvas().style.cursor = "crosshair";
          else if (wasPlacingHotspot) map.getCanvas().style.cursor = "";
          wasPlacingHotspot = interaction?.placing ?? false;
          lastLabelStamp = "";
          updateScene();
        };
        runtimeRef.current = {
          updateScene,
          moveCamera,
          syncLiveDevices,
          syncAudioAlerts,
          syncAmbulances,
          flyToFix,
          syncHotspots,
          syncHotspotDrag,
          placeHotspotAtCenter: () => {
            const center = map.getCenter();
            placeHotspot([center.lng, center.lat]);
          },
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
        syncAudioAlerts();
        // Pick the car's fixed screen-sized footprint using the same continuous
        // position as its marker, independently of zoom or the UI snapshot.
        const nearestUnit = (event: MapMouseEvent) => {
          let id: string | null = null,
            distance = 24;
          for (const person of PEOPLE) {
            if (!vehicleRoute(person.id, frameTime)) continue;
            const p = map.project(sampleVehicle(person.id, frameTime).point),
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
          if (latestRef.current.hotspot?.placing) {
            // A unit remains selectable; only empty map pixels place a flag.
            if (nearestUnit(event) || liveDeviceAt(map, event.point)) return;
            placeHotspot([event.lngLat.lng, event.lngLat.lat]);
            return;
          }
          // A live unit wins the pixel it shares with anything else. The
          // scenario cars are a demonstration; the dot is somebody holding a
          // phone, and it is the one a dispatcher meant to hit.
          const live = liveDeviceAt(map, event.point);
          if (live) {
            latestRef.current.onSelectLiveDevice(live);
            return;
          }
          // Anything that is not a live unit puts the open one away, so the
          // card never goes on describing a dot the viewer has clicked past.
          latestRef.current.onSelectLiveDevice(null);

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
          if (latestRef.current.hotspot?.placing) {
            map.getCanvas().style.cursor = "crosshair";
            return;
          }
          map.getCanvas().style.cursor =
            liveDeviceAt(map, event.point) || nearestUnit(event) || buildingAt(event)
              ? "pointer"
              : "";
        };
        const manualMove = (event: { originalEvent?: unknown }) => {
          if (event.originalEvent && latestRef.current.following)
            latestRef.current.onStopFollowing();
        };
        // Reproject headings on zoom, pan, rotation and pitch, even when paused.
        // A camera event must never issue another follow-camera movement.
        const cameraChanged = () => draw(false);
        const visibility = () => {
          if (document.hidden) stopEdgePan();
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
        const acceptsHotspot = (event: DragEvent) =>
          interactiveReady &&
          latestRef.current.hotspot?.placing &&
          event.dataTransfer?.types.includes("application/x-paw-hotspot") &&
          event.target instanceof Element &&
          !event.target.closest(".mapboxgl-marker, .mapboxgl-control-container, button, a");
        const dragOver = (event: DragEvent) => {
          if (!acceptsHotspot(event)) {
            updateDragPoint(null);
            return;
          }
          event.preventDefault();
          if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
          updateDragPoint({ x: event.clientX, y: event.clientY });
        };
        const drop = (event: DragEvent) => {
          if (!acceptsHotspot(event)) return;
          event.preventDefault();
          event.stopPropagation();
          if (event.dataTransfer?.getData("application/x-paw-hotspot") !== "flag") return;
          dropAtClientPoint({ x: event.clientX, y: event.clientY });
        };
        const dragLeave = (event: DragEvent) => {
          if (event.relatedTarget instanceof Node && mapContainer.contains(event.relatedTarget))
            return;
          updateDragPoint(null);
        };
        const dragEnd = () => updateDragPoint(null);
        mapContainer.addEventListener("dragover", dragOver);
        mapContainer.addEventListener("drop", drop);
        mapContainer.addEventListener("dragleave", dragLeave);
        document.addEventListener("dragend", dragEnd);
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
          stopEdgePan();
          mapContainer.removeEventListener("dragover", dragOver);
          mapContainer.removeEventListener("drop", drop);
          mapContainer.removeEventListener("dragleave", dragLeave);
          document.removeEventListener("dragend", dragEnd);
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
        syncHotspots();
        syncHotspotDrag();
        syncAmbulances();
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
      if (hotspotDragFrame !== null) cancelAnimationFrame(hotspotDragFrame);
      resizeObserver?.disconnect();
      runtimeRef.current = null;
      audioMarkers.forEach(({ marker, dispose }) => {
        dispose();
        marker.remove();
      });
      cleanups.forEach((cleanup) => cleanup());
      markers.forEach(({ marker, direction, dispose }) => {
        dispose();
        marker.remove();
        direction.remove();
      });
      beacons.forEach(({ marker }) => marker.remove());
      hotspotMarkers.forEach(({ marker, glow, dispose }) => {
        dispose();
        marker.remove();
        glow.remove();
      });
      ambulanceMarkers.forEach(({ marker, labelMarker, dispose }) => {
        dispose();
        marker.remove();
        labelMarker.remove();
      });
      healthCentreMarkers.forEach((marker) => marker.remove());
      ownMap?.remove(); // Mapbox calls custom-layer onRemove to release Three resources.
    };
  }, [attempt]);

  const hasError = feedback.status === "error" || feedback.status === "missing-token";
  const selectedHotspot = props.hotspot?.hotspots.find(
    (item) => item.id === selectedHotspotId && item.resolvedAt === null,
  );
  const closeHotspot = () => {
    setSelectedHotspotId(null);
    hotspotMarkerRef.current?.focus();
  };
  return (
    <div className={styles.root} data-theme={theme} data-appearance={props.appearance ?? "default"}>
      <div
        ref={containerRef}
        className={styles.canvas}
        aria-label="Interactive map of simulated patrol vehicles in Cambridge and Boston"
      />
      {props.hotspot?.placing && (
        <div
          className={styles.hotspotPlacement}
          data-ready={feedback.status === "ready"}
          aria-label="Place demo hotspot"
        >
          <PixelHotspotFlag />
          <div>
            <strong>Place a demo hotspot</strong>
            <p role="status">
              {feedback.status === "ready"
                ? "Drop the flag or click the map. Hold near an edge to pan. Escape cancels."
                : "Wait for the map to be ready before placing a flag."}
            </p>
            <div className={styles.hotspotActions}>
              <button
                type="button"
                data-hotspot-centre
                disabled={feedback.status !== "ready"}
                onClick={() => runtimeRef.current?.placeHotspotAtCenter()}
              >
                Place at map centre
              </button>
              <button type="button" onClick={props.hotspot.onCancel}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
      {!props.hotspot?.placing && selectedHotspot && (
        <section
          className={styles.hotspotDetails}
          role="dialog"
          aria-labelledby="hotspot-dialog-title"
          aria-describedby="hotspot-dialog-detail"
        >
          <div className={styles.hotspotDetailTitle}>
            <PixelHotspotFlag />
            <div>
              <span>SIMULATION · ACTIVE HOTSPOT</span>
              <h3 id="hotspot-dialog-title">{selectedHotspot.id}</h3>
            </div>
          </div>
          <p id="hotspot-dialog-detail">
            {selectedHotspot.unitIds.length
              ? `Demo responders: ${selectedHotspot.unitIds.join(", ")}.`
              : "No eligible nearby demo units."}
          </p>
          <p className={styles.hotspotCoordinates}>
            {selectedHotspot.point[1].toFixed(5)}, {selectedHotspot.point[0].toFixed(5)}
          </p>
          <p>Resolve to clear the hotspot and return assigned units to simulated patrol.</p>
          <div className={styles.hotspotActions}>
            <button ref={hotspotCancelRef} type="button" onClick={closeHotspot}>
              Cancel
            </button>
            <button
              type="button"
              className={styles.hotspotResolve}
              onClick={() => {
                props.hotspot?.onResolve(selectedHotspot.id);
                setSelectedHotspotId(null);
                containerRef.current?.querySelector<HTMLCanvasElement>("canvas")?.focus();
              }}
            >
              Resolve hotspot
            </button>
          </div>
        </section>
      )}
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
