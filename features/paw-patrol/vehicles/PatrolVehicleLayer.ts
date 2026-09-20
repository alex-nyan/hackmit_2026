import { MercatorCoordinate, type CustomLayerInterface, type Map as MapboxMap } from "mapbox-gl";
import {
  Camera,
  DirectionalLight,
  HemisphereLight,
  Matrix4,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from "three";

import { createVehicleFleetResources } from "./createPatrolCar";

/** Keep the same threshold in the accessible DOM-marker fallback. */
export const VEHICLE_MIN_ZOOM = 16;
export const VEHICLE_LAYER_ID = "paw-patrol-vehicles";

export interface PatrolVehicleFrame {
  id: string;
  point: [number, number];
  /** Geographic degrees: north is 0, east is 90. */
  heading: number;
  selected: boolean;
  emergency: boolean;
}

export interface PatrolVehicleLayerOptions {
  getVehicles: () => readonly PatrolVehicleFrame[];
  getSeconds: () => number;
  getReducedMotion: () => boolean;
  onFailure: () => void;
}

type FleetResources = ReturnType<typeof createVehicleFleetResources>;
type VehicleModel = ReturnType<FleetResources["createCar"]>;

// Local metre coordinates avoid precision loss from putting small models at
// huge global-world coordinates. This origin never moves with the camera.
const ORIGIN = MercatorCoordinate.fromLngLat([-71.092, 42.36], 0);
const METERS_TO_MERCATOR = ORIGIN.meterInMercatorCoordinateUnits();
const LOCAL_TO_MERCATOR = new Matrix4()
  .makeTranslation(ORIGIN.x, ORIGIN.y, ORIGIN.z)
  .scale(new Vector3(METERS_TO_MERCATOR, -METERS_TO_MERCATOR, METERS_TO_MERCATOR));

function validFrame(vehicle: PatrolVehicleFrame): boolean {
  return (
    Number.isFinite(vehicle.point[0]) &&
    Number.isFinite(vehicle.point[1]) &&
    Math.abs(vehicle.point[0]) <= 180 &&
    Math.abs(vehicle.point[1]) < 85.051129 &&
    Number.isFinite(vehicle.heading)
  );
}

/**
 * One shared Three scene and renderer inside the existing Mapbox GL context.
 * The owner owns timing/repaints; this layer never starts an animation loop.
 * No external model assets or extra canvas/context are required.
 */
export function createPatrolVehicleLayer(options: PatrolVehicleLayerOptions): CustomLayerInterface {
  let map: MapboxMap | undefined;
  let renderer: WebGLRenderer | undefined;
  let scene: Scene | undefined;
  let camera: Camera | undefined;
  let resources: FleetResources | undefined;
  let canvas: HTMLCanvasElement | undefined;
  let contextLost = false;
  let failed = false;
  const cars = new Map<string, VehicleModel>();

  const lostContext = () => {
    contextLost = true;
  };
  const restoredContext = () => {
    contextLost = false;
    // Three rebuilds its internals on this same event. A single repaint is
    // sufficient when the demo is paused; running timing stays with the owner.
    map?.triggerRepaint();
  };

  const release = () => {
    canvas?.removeEventListener("webglcontextlost", lostContext);
    canvas?.removeEventListener("webglcontextrestored", restoredContext);
    canvas = undefined;
    cars.clear();
    resources?.dispose();
    resources = undefined;
    scene?.clear();
    scene = undefined;
    camera = undefined;
    renderer?.dispose();
    renderer = undefined;
    // Do not forceContextLoss: Mapbox owns this context and its building layers.
    map = undefined;
  };

  const fail = () => {
    if (failed) return;
    failed = true;
    release();
    options.onFailure();
  };

  return {
    id: VEHICLE_LAYER_ID,
    type: "custom",
    renderingMode: "3d",

    onAdd(nextMap, gl) {
      // A style replacement can re-add the same layer object. Always begin from
      // a clean resource set rather than retaining programs from the old style.
      release();
      failed = false;
      contextLost = false;
      map = nextMap;
      try {
        canvas = nextMap.getCanvas();
        scene = new Scene();
        camera = new Camera();
        camera.matrixAutoUpdate = false;
        resources = createVehicleFleetResources();

        const ambient = new HemisphereLight(0xfcf7ed, 0x343e8a, 2.4);
        ambient.position.set(0, 0, 1);
        const key = new DirectionalLight(0xfff4da, 2.1);
        key.position.set(-70, -30, 100);
        const fill = new DirectionalLight(0xc4d5ff, 0.9);
        fill.position.set(40, 60, 50);
        scene.add(ambient, key, fill);

        renderer = new WebGLRenderer({ canvas, context: gl, antialias: true });
        renderer.autoClear = false;
        renderer.outputColorSpace = SRGBColorSpace;
        // Mapbox owns canvas size, pixel ratio, clearing, depth and viewport.
        // Never call setSize/setPixelRatio/clear from this shared-context layer.
        canvas.addEventListener("webglcontextlost", lostContext);
        canvas.addEventListener("webglcontextrestored", restoredContext);
      } catch {
        fail();
      }
    },

    render(gl, matrix) {
      if (
        failed ||
        contextLost ||
        gl.isContextLost() ||
        !map ||
        !scene ||
        !camera ||
        !renderer ||
        !resources
      )
        return;
      if (map.getZoom() < VEHICLE_MIN_ZOOM) return;
      try {
        const seen = new Set<string>();
        const seconds = options.getSeconds();
        const reducedMotion = options.getReducedMotion();
        for (const vehicle of options.getVehicles()) {
          if (!validFrame(vehicle) || seen.has(vehicle.id)) continue;
          seen.add(vehicle.id);
          let car = cars.get(vehicle.id);
          if (!car) {
            car = resources.createCar();
            car.group.name = `patrol-unit-${vehicle.id}`;
            // Mapbox supplies a combined projection/view matrix. Explicitly
            // retain the small fleet instead of relying on Three's camera cull.
            car.group.traverse((object) => {
              object.frustumCulled = false;
            });
            cars.set(vehicle.id, car);
            scene.add(car.group);
          }

          const position = MercatorCoordinate.fromLngLat(vehicle.point, 0);
          car.group.position.set(
            (position.x - ORIGIN.x) / METERS_TO_MERCATOR,
            -(position.y - ORIGIN.y) / METERS_TO_MERCATOR,
            0,
          );
          // +Y in the model is north; geographic bearings rotate clockwise.
          car.group.rotation.z = (-vehicle.heading * Math.PI) / 180;
          car.group.scale.setScalar(position.meterInMercatorCoordinateUnits() / METERS_TO_MERCATOR);
          car.setSelected(vehicle.selected);
          car.setEmergency(
            vehicle.emergency,
            Number.isFinite(seconds) ? seconds : 0,
            reducedMotion,
          );
        }
        for (const [id, car] of cars) {
          if (!seen.has(id)) {
            scene.remove(car.group);
            cars.delete(id);
          }
        }

        camera.projectionMatrix.fromArray(matrix).multiply(LOCAL_TO_MERCATOR);
        camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
        renderer.resetState();
        renderer.render(scene, camera);
        renderer.resetState();
      } catch {
        fail();
      }
    },

    onRemove() {
      release();
    },
  };
}
