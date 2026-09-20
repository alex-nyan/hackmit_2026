"use client";

import { CircleAlert, LoaderCircle, Move3D, RotateCcw, ZoomIn, ZoomOut } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

import styles from "./AnatomyViewer.module.css";
import { BODY_REGIONS, classifyBodyRegion, type BodyRegionId } from "./bodyRegions";

export interface AnatomyViewerProps {
  personId: string;
  personName: string;
  annotation?: { label: string; detail: string } | null;
  interactive?: boolean;
  theme?: "light" | "dark";
  selectedRegion?: BodyRegionId | null;
  onSelectRegion?: (region: BodyRegionId | null) => void;
  highlightedRegions?: BodyRegionId[];
}

type View = "front" | "side" | "back";
type Status = { kind: "loading" } | { kind: "ready" } | { kind: "error"; message: string };
type ViewerActions = {
  view: (view: View) => void;
  zoom: (factor: number) => void;
  reset: () => void;
  highlight: (selected: BodyRegionId | null, concerns: readonly BodyRegionId[]) => void;
  theme: (theme: "light" | "dark") => void;
};

const MODEL_URL = "/models/officer-body.glb";
const LOAD_TIMEOUT_MS = 20_000;
const NO_HIGHLIGHTS: BodyRegionId[] = [];

/** Dispose shared model resources once, including embedded GLB image bitmaps. */
function disposeModels(roots: THREE.Object3D[]) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  const skeletons = new Set<THREE.Skeleton>();
  roots.forEach((root) =>
    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      geometries.add(object.geometry);
      const meshMaterials = Array.isArray(object.material) ? object.material : [object.material];
      meshMaterials.forEach((material) => {
        materials.add(material);
        Object.values(material).forEach((value: unknown) => {
          if (value instanceof THREE.Texture) textures.add(value);
        });
      });
      if (object instanceof THREE.SkinnedMesh) skeletons.add(object.skeleton);
    }),
  );
  const images = new Set<ImageBitmap>();
  textures.forEach((texture) => {
    const data: unknown = texture.source.data;
    if (typeof ImageBitmap !== "undefined" && data instanceof ImageBitmap) images.add(data);
    texture.dispose();
  });
  images.forEach((image) => image.close());
  skeletons.forEach((skeleton) => skeleton.dispose());
  materials.forEach((material) => material.dispose());
  geometries.forEach((geometry) => geometry.dispose());
}

/** The keyed session prevents camera or loading state from leaking between people. */
export function AnatomyViewer(props: AnatomyViewerProps) {
  const [attempt, setAttempt] = useState(0);
  return (
    <ViewerSession
      key={`${props.personId}:${attempt}`}
      {...props}
      onRetry={() => setAttempt((value) => value + 1)}
    />
  );
}

function ViewerSession({
  personName,
  annotation,
  interactive = false,
  theme = "dark",
  selectedRegion,
  onSelectRegion,
  highlightedRegions = NO_HIGHLIGHTS,
  onRetry,
}: AnatomyViewerProps & { onRetry: () => void }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const actionsRef = useRef<ViewerActions | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "loading" });
  const [activeView, setActiveView] = useState<View | "custom">("front");
  const [localSelection, setLocalSelection] = useState<BodyRegionId | null>(null);
  const selection = selectedRegion === undefined ? localSelection : selectedRegion;
  const selectRef = useRef<(id: BodyRegionId | null) => void>(() => {});
  const headingId = useId();
  const helpId = useId();

  const chooseRegion = (id: BodyRegionId | null) => {
    if (selectedRegion === undefined) setLocalSelection(id);
    onSelectRegion?.(id);
  };

  useEffect(() => {
    selectRef.current = (id) => {
      if (selectedRegion === undefined) setLocalSelection(id);
      onSelectRegion?.(id);
    };
  }, [onSelectRegion, selectedRegion]);

  useEffect(() => {
    actionsRef.current?.highlight(selection, highlightedRegions);
  }, [selection, highlightedRegions, status]);

  useEffect(() => {
    actionsRef.current?.theme(theme);
  }, [theme, status]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const abort = new AbortController();
    let mounted = true;
    let failed = false;
    let released = false;
    let frame = 0;
    let renderer: THREE.WebGLRenderer | undefined;
    let controls: OrbitControls | undefined;
    let observer: ResizeObserver | undefined;
    let roots: THREE.Object3D[] = [];
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let contextLost: ((event: Event) => void) | undefined;
    let keyboard: ((event: KeyboardEvent) => void) | undefined;
    let pointerDown: ((event: PointerEvent) => void) | undefined;
    let pointerMove: ((event: PointerEvent) => void) | undefined;
    let pointerUp: ((event: PointerEvent) => void) | undefined;
    let pointerCancel: (() => void) | undefined;

    const release = () => {
      if (released) return;
      released = true;
      clearTimeout(timeout);
      abort.abort();
      cancelAnimationFrame(frame);
      observer?.disconnect();
      controls?.dispose();
      disposeModels(roots);
      roots = [];
      actionsRef.current = null;
      if (renderer) {
        if (contextLost) renderer.domElement.removeEventListener("webglcontextlost", contextLost);
        if (keyboard) renderer.domElement.removeEventListener("keydown", keyboard);
        if (pointerDown) renderer.domElement.removeEventListener("pointerdown", pointerDown);
        if (pointerMove) renderer.domElement.removeEventListener("pointermove", pointerMove);
        if (pointerUp) renderer.domElement.removeEventListener("pointerup", pointerUp);
        if (pointerCancel) renderer.domElement.removeEventListener("pointercancel", pointerCancel);
        renderer.dispose();
        renderer.forceContextLoss();
        renderer.domElement.remove();
      }
    };

    const fail = (message: string) => {
      if (!mounted || failed) return;
      failed = true;
      release();
      setStatus({ kind: "error", message });
    };

    async function initialize() {
      try {
        const scene = new THREE.Scene();
        scene.background = new THREE.Color(interactive ? "#111a23" : "#fcf7ed");
        const camera = new THREE.PerspectiveCamera(34, 1, 0.01, 1000);
        renderer = new THREE.WebGLRenderer({
          antialias: true,
          alpha: false,
          powerPreference: "low-power",
        });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1;
        renderer.domElement.tabIndex = 0;
        renderer.domElement.setAttribute(
          "aria-label",
          interactive
            ? "Interactive body surface. Click a region to select it, or use the region buttons below. Arrow keys rotate, plus or minus zoom, and Home resets."
            : "Interactive anatomy model. Use arrow keys to rotate, plus or minus to zoom, and Home to reset.",
        );
        if (!interactive) renderer.domElement.setAttribute("aria-describedby", helpId);
        host!.appendChild(renderer.domElement);

        contextLost = (event) => {
          event.preventDefault();
          fail("The 3D view was interrupted. Retry to restore the model.");
        };
        renderer.domElement.addEventListener("webglcontextlost", contextLost);

        const ambient = new THREE.HemisphereLight(0xffffff, 0xc7c3b6, 2.1);
        const key = new THREE.DirectionalLight(0xfffaf2, 3.1);
        key.position.set(4, 6, 6);
        const fill = new THREE.DirectionalLight(0xe8efff, 1.7);
        fill.position.set(-5, 2, 3);
        const rim = new THREE.DirectionalLight(0xffffff, 2);
        rim.position.set(1, 4, -4);
        scene.add(ambient, key, fill, rim);

        const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = !reducedMotion;
        controls.dampingFactor = 0.085;
        controls.enablePan = false;
        controls.rotateSpeed = 0.7;
        controls.zoomSpeed = 0.75;
        controls.minPolarAngle = 0.12;
        controls.maxPolarAngle = Math.PI - 0.12;

        let distance = 4;
        const size = new THREE.Vector3();
        let motion: {
          start: THREE.Spherical;
          end: THREE.Spherical;
          thetaDelta: number;
          time: number;
        } | null = null;
        const animatedOrbit = new THREE.Spherical();
        let hasInteracted = false;
        const fitDistance = () => {
          if (size.y <= 0) return distance;
          const verticalFov = THREE.MathUtils.degToRad(camera.fov);
          const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * camera.aspect);
          const bodyWidth = Math.hypot(size.x, size.z);
          return (
            Math.max(
              size.y / (2 * Math.tan(verticalFov / 2)),
              bodyWidth / (2 * Math.tan(horizontalFov / 2)),
            ) *
              1.17 +
            bodyWidth / 2
          );
        };
        const moveCamera = (position: THREE.Vector3) => {
          if (reducedMotion) {
            camera.position.copy(position);
            controls!.update();
          } else {
            const start = new THREE.Spherical().setFromVector3(
              camera.position.clone().sub(controls!.target),
            );
            const end = new THREE.Spherical().setFromVector3(
              position.clone().sub(controls!.target),
            );
            const thetaDelta = Math.atan2(
              Math.sin(end.theta - start.theta),
              Math.cos(end.theta - start.theta),
            );
            motion = { start, end, thetaDelta, time: performance.now() };
          }
        };
        const selectView = (view: View) => {
          hasInteracted = true;
          const position =
            view === "side"
              ? new THREE.Vector3(distance, 0, 0)
              : new THREE.Vector3(0, 0, view === "back" ? -distance : distance);
          moveCamera(position);
          setActiveView(view);
        };
        const zoom = (factor: number) => {
          hasInteracted = true;
          const offset = camera.position.clone().sub(controls!.target);
          const nextDistance = THREE.MathUtils.clamp(
            offset.length() * factor,
            controls!.minDistance,
            controls!.maxDistance,
          );
          moveCamera(offset.setLength(nextDistance).add(controls!.target));
        };
        const reset = () => {
          distance = fitDistance();
          controls!.target.set(0, 0, 0);
          selectView("front");
          hasInteracted = false;
        };
        controls.addEventListener("start", () => {
          motion = null;
          hasInteracted = true;
          setActiveView("custom");
        });

        keyboard = (event) => {
          if (!actionsRef.current) return;
          if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
            event.preventDefault();
            hasInteracted = true;
            const spherical = new THREE.Spherical().setFromVector3(
              camera.position.clone().sub(controls!.target),
            );
            spherical.theta +=
              event.key === "ArrowLeft" ? -0.16 : event.key === "ArrowRight" ? 0.16 : 0;
            spherical.phi = THREE.MathUtils.clamp(
              spherical.phi +
                (event.key === "ArrowUp" ? -0.12 : event.key === "ArrowDown" ? 0.12 : 0),
              controls!.minPolarAngle,
              controls!.maxPolarAngle,
            );
            moveCamera(new THREE.Vector3().setFromSpherical(spherical).add(controls!.target));
            setActiveView("custom");
          } else if (event.key === "+" || event.key === "=") {
            event.preventDefault();
            zoom(0.8);
          } else if (event.key === "-" || event.key === "_") {
            event.preventDefault();
            zoom(1.25);
          } else if (event.key === "Home") {
            event.preventDefault();
            reset();
          } else if (interactive && event.key === "Escape") {
            event.preventDefault();
            selectRef.current(null);
          }
        };
        renderer.domElement.addEventListener("keydown", keyboard);

        const resize = () => {
          const width = Math.max(host!.clientWidth, 1);
          const height = Math.max(host!.clientHeight, 1);
          renderer!.setSize(width, height, false);
          camera.aspect = width / height;
          camera.updateProjectionMatrix();
          if (size.y > 0) {
            distance = fitDistance();
            controls!.maxDistance = distance * 2.5;
            if (!hasInteracted) camera.position.set(0, 0, distance);
          }
        };
        observer = new ResizeObserver(resize);
        observer.observe(host!);
        resize();

        const animate = (time: number) => {
          if (!mounted || failed) return;
          if (motion) {
            const progress = Math.min((time - motion.time) / 360, 1);
            const eased = 1 - (1 - progress) ** 3;
            // Orbit along the shortest arc; never cut through the body between presets.
            animatedOrbit.set(
              THREE.MathUtils.lerp(motion.start.radius, motion.end.radius, eased),
              THREE.MathUtils.lerp(motion.start.phi, motion.end.phi, eased),
              motion.start.theta + motion.thetaDelta * eased,
            );
            camera.position.setFromSpherical(animatedOrbit).add(controls!.target);
            if (progress === 1) motion = null;
          }
          controls!.update();
          renderer!.render(scene, camera);
          frame = requestAnimationFrame(animate);
        };

        timeout = setTimeout(
          () =>
            fail(
              "The model is taking longer than expected to load. Check your connection and retry.",
            ),
          LOAD_TIMEOUT_MS,
        );
        const response = await fetch(MODEL_URL, { signal: abort.signal });
        if (!response.ok) throw new Error(`Model response: ${response.status}`);
        const data = await response.arrayBuffer();
        if (!mounted || failed) return;
        const model = await new GLTFLoader().parseAsync(data, "/models/");
        if (!mounted || failed) {
          disposeModels(model.scenes);
          return;
        }
        roots = model.scenes;
        // Keep the supplied geometry and materials. Center through a parent group only.
        const bounds = new THREE.Box3().setFromObject(model.scene);
        if (bounds.isEmpty()) throw new Error("The body model contains no visible geometry.");
        bounds.getSize(size);
        if (![size.x, size.y, size.z].every(Number.isFinite) || size.y <= 0)
          throw new Error("The body model has invalid bounds.");
        const center = bounds.getCenter(new THREE.Vector3());
        const body = new THREE.Group();
        body.add(model.scene);
        body.position.copy(center).multiplyScalar(-1);
        scene.add(body);
        body.updateMatrixWorld(true);

        // Colour the real mesh surface, not an invented skeleton or organ overlay.
        const surfaces: {
          regions: BodyRegionId[];
          colors: THREE.BufferAttribute;
        }[] = [];
        if (interactive) {
          const vertex = new THREE.Vector3();
          model.scene.traverse((object) => {
            if (!(object instanceof THREE.Mesh)) return;
            const positions = object.geometry.getAttribute("position");
            if (!positions) return;
            const colors = new THREE.BufferAttribute(new Float32Array(positions.count * 3), 3);
            const regions: BodyRegionId[] = [];
            for (let i = 0; i < positions.count; i += 1) {
              vertex.fromBufferAttribute(positions, i).applyMatrix4(object.matrixWorld);
              regions.push(classifyBodyRegion(vertex.x / size.y, vertex.y / size.y + 0.5));
            }
            object.geometry.setAttribute("color", colors);
            const materials = Array.isArray(object.material) ? object.material : [object.material];
            materials.forEach((material) => {
              if (material instanceof THREE.MeshStandardMaterial) {
                material.vertexColors = true;
                material.color.set("#ffffff");
                material.roughness = 0.7;
                material.metalness = 0.08;
                material.needsUpdate = true;
              }
            });
            surfaces.push({ regions, colors });
          });

          const raycaster = new THREE.Raycaster();
          const pointer = new THREE.Vector2();
          let press: { x: number; y: number; id: number; moved: boolean } | null = null;
          pointerDown = (event) => {
            // A pinch or any non-primary gesture must never choose a medical region.
            if (!event.isPrimary || event.button !== 0) {
              press = null;
              return;
            }
            press = { x: event.clientX, y: event.clientY, id: event.pointerId, moved: false };
          };
          pointerMove = (event) => {
            if (
              press &&
              press.id === event.pointerId &&
              Math.hypot(event.clientX - press.x, event.clientY - press.y) > 6
            ) {
              press.moved = true;
            }
          };
          pointerCancel = () => {
            press = null;
          };
          pointerUp = (event) => {
            const start = press;
            press = null;
            if (
              !start ||
              start.moved ||
              start.id !== event.pointerId ||
              Math.hypot(event.clientX - start.x, event.clientY - start.y) > 6
            )
              return;
            const rect = renderer!.domElement.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) return;
            pointer.set(
              ((event.clientX - rect.left) / rect.width) * 2 - 1,
              -((event.clientY - rect.top) / rect.height) * 2 + 1,
            );
            raycaster.setFromCamera(pointer, camera);
            const hit = raycaster.intersectObject(model.scene, true)[0];
            if (hit)
              selectRef.current(
                classifyBodyRegion(hit.point.x / size.y, hit.point.y / size.y + 0.5),
              );
          };
          renderer.domElement.addEventListener("pointerdown", pointerDown);
          renderer.domElement.addEventListener("pointermove", pointerMove);
          renderer.domElement.addEventListener("pointerup", pointerUp);
          renderer.domElement.addEventListener("pointercancel", pointerCancel);
        }
        const highlight = (selected: BodyRegionId | null, concerns: readonly BodyRegionId[]) => {
          const neutral = new THREE.Color("#a4b2be");
          const cyan = new THREE.Color("#26c5ef");
          const red = new THREE.Color("#df4c64");
          const selectedConcern = new THREE.Color("#f98293");
          surfaces.forEach(({ colors, regions }) => {
            regions.forEach((region, index) => {
              const concern = concerns.includes(region);
              const color = concern
                ? region === selected
                  ? selectedConcern
                  : red
                : region === selected
                  ? cyan
                  : neutral;
              colors.setXYZ(index, color.r, color.g, color.b);
            });
            colors.needsUpdate = true;
          });
        };
        highlight(null, []);
        distance = fitDistance();
        camera.near = Math.max(size.length() / 1000, 0.001);
        camera.far = Math.max(distance * 15, size.length() * 20);
        camera.updateProjectionMatrix();
        camera.position.set(0, 0, distance);
        controls.target.set(0, 0, 0);
        controls.minDistance = size.length() * 0.3;
        controls.maxDistance = distance * 2.5;
        controls.update();
        actionsRef.current = {
          view: selectView,
          zoom,
          reset,
          highlight,
          theme: (nextTheme) => {
            if (interactive)
              scene.background = new THREE.Color(nextTheme === "dark" ? "#111a23" : "#edf2f4");
          },
        };
        clearTimeout(timeout);
        setStatus({ kind: "ready" });
        frame = requestAnimationFrame(animate);
      } catch (error) {
        if (!mounted || failed) return;
        console.warn("Anatomy viewer could not initialize:", error);
        fail(
          renderer
            ? "The anatomy model could not be loaded. Please retry."
            : "3D viewing is unavailable in this browser. Try enabling graphics acceleration, then retry.",
        );
      }
    }

    void initialize();
    return () => {
      mounted = false;
      release();
    };
  }, [helpId, interactive]);

  const ready = status.kind === "ready";

  return (
    <section
      className={`${styles.viewer} ${interactive ? styles.interactive : ""}`}
      data-theme={theme}
      aria-labelledby={headingId}
    >
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>{interactive ? "Body region review" : "Body overview"}</p>
          <h3 id={headingId}>{personName}</h3>
        </div>
        <span className={styles.modelBadge}>
          <Move3D size={15} aria-hidden="true" /> {interactive ? "Surface model" : "3D anatomy"}
        </span>
      </header>

      <div className={styles.stage} aria-busy={status.kind === "loading"}>
        <div className={styles.canvasHost} ref={hostRef} />
        {status.kind === "loading" && (
          <div className={styles.status} role="status">
            <LoaderCircle className={styles.spinner} size={27} aria-hidden="true" />
            <strong>Preparing the body model</strong>
            <span>This may take a moment.</span>
          </div>
        )}
        {status.kind === "error" && (
          <div className={styles.status} role="alert">
            <CircleAlert size={28} aria-hidden="true" />
            <strong>Unable to open the 3D view</strong>
            <span>{status.message}</span>
            <button type="button" className={styles.retry} onClick={onRetry}>
              <RotateCcw size={15} aria-hidden="true" /> Retry model
            </button>
          </div>
        )}
        {ready && (
          <span className={styles.orientation}>
            {activeView === "custom"
              ? "Free view"
              : `${activeView[0].toUpperCase()}${activeView.slice(1)} view`}
          </span>
        )}
        <div className={styles.zoomControls} role="group" aria-label="Model zoom">
          <button
            type="button"
            title="Zoom in"
            aria-label="Zoom in on anatomy"
            disabled={!ready}
            onClick={() => actionsRef.current?.zoom(0.8)}
          >
            <ZoomIn size={18} aria-hidden="true" />
          </button>
          <button
            type="button"
            title="Zoom out"
            aria-label="Zoom out of anatomy"
            disabled={!ready}
            onClick={() => actionsRef.current?.zoom(1.25)}
          >
            <ZoomOut size={18} aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className={styles.toolbar}>
        <div className={styles.presets} role="group" aria-label="Anatomy viewing angle">
          {(["front", "side", "back"] as const).map((view) => (
            <button
              key={view}
              type="button"
              disabled={!ready}
              aria-pressed={activeView === view}
              onClick={() => actionsRef.current?.view(view)}
            >
              {view[0].toUpperCase()}
              {view.slice(1)}
            </button>
          ))}
        </div>
        <button
          className={styles.reset}
          type="button"
          disabled={!ready}
          onClick={() => actionsRef.current?.reset()}
        >
          <RotateCcw size={15} aria-hidden="true" /> Reset
        </button>
      </div>
      {interactive && (
        <div className={styles.regionPicker}>
          <div className={styles.selectionStatus} aria-live="polite" aria-atomic="true">
            <strong>
              {BODY_REGIONS.find((region) => region.id === selection)?.label ??
                "Select a body region"}
            </strong>
            {selection && (
              <button type="button" onClick={() => chooseRegion(null)}>
                Clear selection
              </button>
            )}
          </div>
          <div className={styles.regionButtons} role="group" aria-label="Select body region">
            {BODY_REGIONS.map((region) => (
              <button
                key={region.id}
                type="button"
                aria-pressed={selection === region.id}
                data-concern={highlightedRegions.includes(region.id) || undefined}
                aria-label={`${region.label}${highlightedRegions.includes(region.id) ? ", concern reported; review evidence" : ""}`}
                onClick={() => chooseRegion(region.id)}
              >
                {highlightedRegions.includes(region.id) && (
                  <CircleAlert size={12} aria-hidden="true" />
                )}
                {region.label}
              </button>
            ))}
          </div>
          <div className={styles.legend}>
            <span>
              <i className={styles.selectedKey} />
              Selected
            </span>
            <span>
              <i className={styles.concernKey} />
              Reported concern
            </span>
            <span>Unmarked ≠ assessed</span>
          </div>
        </div>
      )}
      {!interactive && (
        <>
          <p className={styles.help} id={helpId}>
            Drag to rotate · Scroll or pinch to zoom
          </p>
          <p className={styles.modelNote}>
            Generic anatomical representation · not a scan of this person
          </p>
        </>
      )}

      {annotation && (
        <aside className={styles.annotation}>
          <span className={styles.annotationDot} aria-hidden="true" />
          <div>
            <strong>{annotation.label}</strong>
            <p>{annotation.detail}</p>
            <span className={styles.annotationNote}>
              Staged scenario note · location not mapped
            </span>
          </div>
        </aside>
      )}
    </section>
  );
}

export default AnatomyViewer;
