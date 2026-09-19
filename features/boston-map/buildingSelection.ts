const EARTH_RADIUS_M = 6378137;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Signed spherical area of one closed ring (Chamberlain & Duquette). Sign
 * carries the winding direction, which distinguishes outer rings from holes.
 */
export function ringAreaM2(ring: ReadonlyArray<readonly [number, number]>): number {
  if (ring.length < 3) return 0;

  let total = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const [lon1, lat1] = ring[index];
    const [lon2, lat2] = ring[(index + 1) % ring.length];
    total += toRadians(lon2 - lon1) * (2 + Math.sin(toRadians(lat1)) + Math.sin(toRadians(lat2)));
  }
  return (total * EARTH_RADIUS_M * EARTH_RADIUS_M) / 2;
}

type Ring = ReadonlyArray<readonly [number, number]>;

/** Outer ring minus its holes, for a Polygon or MultiPolygon footprint. */
export function polygonAreaM2(geometry: unknown): number | null {
  if (typeof geometry !== "object" || geometry === null) return null;
  const shape = geometry as { type?: unknown; coordinates?: unknown };

  const polygons: Ring[][] =
    shape.type === "Polygon"
      ? [shape.coordinates as Ring[]]
      : shape.type === "MultiPolygon"
        ? (shape.coordinates as Ring[][])
        : [];

  if (polygons.length === 0) return null;

  let area = 0;
  for (const rings of polygons) {
    if (!Array.isArray(rings) || rings.length === 0) continue;
    // The first ring is the outline; any that follow are holes.
    area += Math.abs(ringAreaM2(rings[0]));
    for (let index = 1; index < rings.length; index += 1) {
      area -= Math.abs(ringAreaM2(rings[index]));
    }
  }

  return area > 0 ? area : null;
}

export interface BuildingFacts {
  /** Roof height above ground in metres, as carried by the tile. */
  heightM: number | null;
  /** Height at which the extrusion starts; non-zero for elevated structures. */
  baseM: number | null;
  /**
   * Footprint area in square metres. Vector tiles clip geometry at tile edges,
   * so a building spanning a boundary reports only the part in the clicked tile.
   */
  footprintM2: number | null;
  /** Mapbox feature id, absent on tiles that do not carry one. */
  id: string | number | null;
}

export function describeBuilding(feature: unknown): BuildingFacts | null {
  if (typeof feature !== "object" || feature === null) return null;
  const record = feature as { properties?: unknown; geometry?: unknown; id?: unknown };

  const properties =
    typeof record.properties === "object" && record.properties !== null
      ? (record.properties as Record<string, unknown>)
      : {};

  const heightM = finite(properties.height);
  const baseM = finite(properties.min_height);

  return {
    heightM: heightM !== null && heightM >= 0 ? heightM : null,
    baseM: baseM !== null && baseM > 0 ? baseM : null,
    footprintM2: polygonAreaM2(record.geometry),
    id: typeof record.id === "string" || typeof record.id === "number" ? record.id : null,
  };
}

export function formatHeight(metres: number | null): string {
  if (metres === null) return "not recorded";
  return `${metres.toFixed(metres < 10 ? 1 : 0)} m`;
}

export function formatArea(squareMetres: number | null): string {
  if (squareMetres === null) return "not recorded";
  return `${Math.round(squareMetres).toLocaleString("en-US")} m²`;
}
