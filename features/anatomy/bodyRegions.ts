/** Coarse external body regions, not diagnostic anatomy or internal organ segments. */
export const BODY_REGIONS = [
  { id: "head", label: "Head" },
  { id: "neck", label: "Neck" },
  { id: "chest", label: "Chest" },
  { id: "abdomen", label: "Abdomen" },
  { id: "pelvis", label: "Pelvis" },
  { id: "left-arm", label: "Left arm" },
  { id: "right-arm", label: "Right arm" },
  { id: "left-leg", label: "Left leg" },
  { id: "right-leg", label: "Right leg" },
] as const;

export type BodyRegionId = (typeof BODY_REGIONS)[number]["id"];

/**
 * Approximate surface mapping for the bundled upright, front-facing base mesh.
 * x is measured from the model centre in body heights; y is 0 at feet, 1 at head.
 * Left/right refer to the represented person, not the viewer's screen.
 */
export function classifyBodyRegion(x: number, y: number): BodyRegionId {
  if (y >= 0.865) return "head";
  if (y >= 0.818 && Math.abs(x) < 0.047) return "neck";
  if (y > 0.4 && Math.abs(x) > (y > 0.73 ? 0.115 : 0.095)) {
    return x >= 0 ? "left-arm" : "right-arm";
  }
  if (y >= 0.675) return "chest";
  if (y >= 0.55) return "abdomen";
  if (y >= 0.445) return "pelvis";
  return x >= 0 ? "left-leg" : "right-leg";
}
