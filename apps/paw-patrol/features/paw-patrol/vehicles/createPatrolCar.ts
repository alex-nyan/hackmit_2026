import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

/** Original procedural artwork. Dimensions are metres; +Y is forward and +Z is up. */
export type PatrolCar = {
  group: THREE.Group;
  setSelected: (selected: boolean) => void;
  setEmergency: (
    active: boolean,
    seconds: number,
    reducedMotion: boolean,
  ) => void;
};

type Finish = "indigo" | "cream" | "glass" | "rubber" | "metal" | "gold" | "headlamp" | "tail";
type Point = readonly [number, number, number];
type BodyRing = {
  halfWidth: number;
  halfLength: number;
  chamfer: number;
  z: number;
  centerY?: number;
};

function chamferedBody(rings: BodyRing[]): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  for (const { halfWidth: x, halfLength: y, chamfer: c, z, centerY = 0 } of rings) {
    const perimeter = [
      [-x + c, -y], [x - c, -y], [x, -y + c], [x, y - c],
      [x - c, y], [-x + c, y], [-x, y - c], [-x, -y + c],
    ];
    for (const [px, py] of perimeter) positions.push(px, py + centerY, z);
  }
  for (let ring = 0; ring < rings.length - 1; ring += 1) {
    for (let corner = 0; corner < 8; corner += 1) {
      const a = ring * 8 + corner;
      const b = ring * 8 + (corner + 1) % 8;
      indices.push(a, b, a + 8, b, b + 8, a + 8);
    }
  }
  const top = (rings.length - 1) * 8;
  for (let corner = 1; corner < 7; corner += 1) {
    indices.push(0, corner + 1, corner, top, top + corner, top + corner + 1);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * Own one resource set per map layer, not per frame or vehicle. Static pieces are
 * merged by finish and shared across cars. Only the two emergency-lamp materials
 * are per-car. The owner must call dispose() after removing its map layer.
 */
export function createVehicleFleetResources(): {
  createCar: () => PatrolCar;
  dispose: () => void;
} {
  const parts = new Map<Finish, THREE.BufferGeometry[]>();
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const groups = new Set<THREE.Group>();
  let disposed = false;

  const finish = (options: THREE.MeshStandardMaterialParameters) => {
    const material = new THREE.MeshStandardMaterial(options);
    materials.add(material);
    return material;
  };
  const finishes: Record<Finish, THREE.MeshStandardMaterial> = {
    indigo: finish({ color: "#343e8a", roughness: 0.48, metalness: 0.18 }),
    cream: finish({ color: "#fcf7ed", roughness: 0.6, metalness: 0.1 }),
    glass: finish({ color: "#243446", roughness: 0.2, metalness: 0.4 }),
    rubber: finish({ color: "#171e2d", roughness: 0.95 }),
    metal: finish({ color: "#aeb8c5", roughness: 0.35, metalness: 0.7 }),
    gold: finish({ color: "#efdb98", roughness: 0.5, metalness: 0.22 }),
    headlamp: finish({ color: "#fff1cd", emissive: "#fce4a4", emissiveIntensity: 0.25, roughness: 0.25 }),
    tail: finish({ color: "#a9535e", roughness: 0.35 }),
  };

  const add = (material: Finish, geometry: THREE.BufferGeometry) => {
    // All merged pieces have the same attributes; this model needs no UV textures.
    geometry.deleteAttribute("uv");
    const existing = parts.get(material) ?? [];
    existing.push(geometry);
    parts.set(material, existing);
  };
  const box = (material: Finish, size: Point, position: Point) => {
    const geometry = new THREE.BoxGeometry(...size);
    geometry.translate(...position);
    add(material, geometry);
  };
  const beam = (material: Finish, from: Point, to: Point, width: number) => {
    const start = new THREE.Vector3(...from);
    const end = new THREE.Vector3(...to);
    const direction = end.clone().sub(start);
    const geometry = new THREE.BoxGeometry(width, width, direction.length());
    geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 0, 1), direction.normalize(),
    ));
    geometry.translate(...start.add(end).multiplyScalar(0.5).toArray());
    add(material, geometry);
  };

  // Overall footprint: 4.6m long x 1.9m wide. Chamfered bumpers and a tapered
  // cabin distinguish a road car from a rectangular icon at street-level zoom.
  add("indigo", chamferedBody([
    { halfWidth: 0.83, halfLength: 2.15, chamfer: 0.22, z: 0.34 },
    { halfWidth: 0.94, halfLength: 2.3, chamfer: 0.19, z: 0.62 },
    { halfWidth: 0.88, halfLength: 2.19, chamfer: 0.16, z: 0.95 },
  ]));
  box("rubber", [1.64, 3.76, 0.2], [0, 0, 0.38]);
  add("glass", chamferedBody([
    { halfWidth: 0.81, halfLength: 1.18, chamfer: 0.05, z: 0.93, centerY: -0.05 },
    { halfWidth: 0.69, halfLength: 0.74, chamfer: 0.07, z: 1.35, centerY: -0.08 },
  ]));
  add("cream", chamferedBody([
    { halfWidth: 0.71, halfLength: 0.76, chamfer: 0.08, z: 1.34, centerY: -0.08 },
    { halfWidth: 0.69, halfLength: 0.74, chamfer: 0.08, z: 1.39, centerY: -0.08 },
  ]));

  for (const side of [-1, 1]) {
    // Door panels, fine gold livery, pillars and mirrors all stay within the
    // 1.9m envelope. No floating labels or giant selection sprites are baked in.
    box("cream", [0.032, 2.08, 0.26], [side * 0.914, -0.03, 0.72]);
    box("gold", [0.018, 3.25, 0.042], [side * 0.936, 0.02, 0.575]);
    box("cream", [0.17, 0.18, 0.075], [side * 0.865, 0.83, 0.99]);
    beam("cream", [side * 0.786, 1.08, 0.94], [side * 0.681, 0.635, 1.36], 0.072);
    beam("cream", [side * 0.786, -1.18, 0.94], [side * 0.681, -0.79, 1.36], 0.078);
    beam("indigo", [side * 0.812, -0.08, 0.94], [side * 0.697, -0.08, 1.35], 0.065);
    box("metal", [0.018, 0.16, 0.035], [side * 0.939, 0.17, 0.835]);
    box("metal", [0.018, 0.16, 0.035], [side * 0.939, -0.67, 0.835]);

    const badge = new THREE.CylinderGeometry(0.115, 0.115, 0.015, 6);
    badge.rotateZ(Math.PI / 2);
    badge.translate(side * 0.941, 0.4, 0.725);
    add("gold", badge);
    for (const axle of [-1.42, 1.42]) {
      const tire = new THREE.CylinderGeometry(0.32, 0.32, 0.2, 14);
      tire.rotateZ(Math.PI / 2);
      tire.translate(side * 0.85, axle, 0.32); // tyre bottom is exactly z=0.
      add("rubber", tire);
      const rim = new THREE.CylinderGeometry(0.17, 0.17, 0.205, 10);
      rim.rotateZ(Math.PI / 2);
      rim.translate(side * 0.85, axle, 0.32);
      add("metal", rim);
    }
    box("headlamp", [0.3, 0.06, 0.12], [side * 0.61, 2.184, 0.815]);
    box("tail", [0.27, 0.06, 0.11], [side * 0.64, -2.18, 0.815]);
  }
  box("rubber", [1.15, 0.03, 0.145], [0, 2.274, 0.67]);
  box("metal", [1.24, 0.035, 0.034], [0, 2.284, 0.71]);
  box("cream", [0.3, 0.025, 0.075], [0, 2.291, 0.565]);
  box("cream", [0.3, 0.025, 0.075], [0, -2.291, 0.66]);
  box("rubber", [1.25, 0.29, 0.055], [0, 0.11, 1.416]);
  box("cream", [0.25, 0.25, 0.085], [0, 0.11, 1.465]);

  const merged = [...parts.entries()].map(([name, pieces]) => {
    const geometry = mergeGeometries(pieces);
    for (const piece of pieces) piece.dispose();
    geometries.add(geometry);
    return { name, geometry, material: finishes[name] };
  });
  parts.clear();

  const lampGeometry = new THREE.BoxGeometry(0.44, 0.25, 0.085);
  geometries.add(lampGeometry);
  const ringGeometry = new THREE.RingGeometry(0.93, 1, 48);
  ringGeometry.scale(1.2, 2.63, 1);
  geometries.add(ringGeometry);
  const ringMaterial = new THREE.MeshBasicMaterial({
    color: "#efdb98", transparent: true, opacity: 0.82, depthWrite: false,
    side: THREE.DoubleSide, toneMapped: false,
  });
  materials.add(ringMaterial);

  return {
    createCar() {
      if (disposed) throw new Error("Cannot create a patrol car after fleet disposal.");
      const group = new THREE.Group();
      group.name = "Paw Patrol vehicle";
      groups.add(group);
      for (const { name, geometry, material } of merged) {
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = `Vehicle ${name}`;
        group.add(mesh);
      }
      const lamps = [
        finish({ color: "#6389c9", emissive: "#5e86e5", emissiveIntensity: 0, roughness: 0.25, toneMapped: false }),
        finish({ color: "#bb6973", emissive: "#d2747e", emissiveIntensity: 0, roughness: 0.25, toneMapped: false }),
      ];
      for (const [index, material] of lamps.entries()) {
        const lamp = new THREE.Mesh(lampGeometry, material);
        lamp.name = "Emergency light bar";
        lamp.position.set(index === 0 ? -0.37 : 0.37, 0.11, 1.465);
        group.add(lamp);
      }
      const selection = new THREE.Mesh(ringGeometry, ringMaterial);
      selection.name = "Selected unit outline";
      selection.position.z = 0.018;
      selection.visible = false;
      group.add(selection);

      return {
        group,
        setSelected(selected) {
          if (!disposed) selection.visible = selected;
        },
        setEmergency(active, seconds, reducedMotion) {
          if (disposed) return;
          // A gentle 0.6Hz brightness breath, never a strobe. Reduced motion
          // receives a static indication; no emergency means no emissive light.
          const phase = Number.isFinite(seconds) ? seconds * Math.PI * 2 * 0.6 : 0;
          for (const [index, material] of lamps.entries()) {
            material.emissiveIntensity = !active ? 0 : reducedMotion ? 0.35
              : 0.26 + 0.18 * (1 + Math.sin(phase + index * Math.PI));
          }
        },
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const group of groups) {
        group.removeFromParent();
        group.clear();
      }
      groups.clear();
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
      geometries.clear();
      materials.clear();
    },
  };
}
