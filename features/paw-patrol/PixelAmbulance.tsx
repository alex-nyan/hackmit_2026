import type { SVGProps } from "react";

// Original north-facing artwork. A blue Star of Life distinguishes medical
// transport from patrol cars without relying on an emergency animation.
const PARTS = [
  ["M8 18h6v17H8Zm42 0h6v17h-6ZM8 66h6v17H8Zm42 0h6v17h-6Z", "#17212c"],
  ["M17 3h30v3h5v7h3v74h-3v5H12v-5H9V13h3V6h5Z", "#26313b"],
  ["M17 6h30v3h3v76H14V9h3Z", "#f5f5ed"],
  ["M17 9h30v10H17Z", "#e1e7e8"],
  ["M17 19h30v3h2v11H15V22h2Z", "#233b56"],
  ["M19 21h24v2H19Z", "#7895af"],
  ["M3 25h10v5H3Zm48 0h10v5H51Z", "#273644"],
  ["M14 35h36v49H14Z", "#fffdf3"],
  ["M14 39h5v39h-5Zm31 0h5v39h-5ZM14 79h36v5H14Z", "#e64247"],
  ["M17 35h30v3H17Z", "#bccbd3"],
  ["M21 36h10v5H21Z", "#4193e2"],
  ["M33 36h10v5H33Z", "#ed3c4a"],
  ["M29 48h6v9l8-5 3 5-8 5 8 5-3 5-8-5v10h-6V67l-8 5-3-5 8-5-8-5 3-5 8 5Z", "#2871b6"],
  ["M31 53h2v19h-2ZM28 58h3v2h-3Zm5 5h3v2h-3Z", "#fffdf3"],
  ["M17 85h30v3H17Z", "#acbbc6"],
  ["M15 86h5v3h-5Zm29 0h5v3h-5Z", "#ed3c4a"],
  ["M16 12h5v3h-5Zm27 0h5v3h-5Z", "#fffceb"],
] as const;

export function PixelAmbulance(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 64 96" fill="none" shapeRendering="crispEdges" aria-hidden="true" {...props}>
      {PARTS.map(([d, fill], index) => (
        <path key={index} d={d} fill={fill} />
      ))}
    </svg>
  );
}

/** Fixed trusted artwork for Mapbox's native marker, not user/model markup. */
export const PIXEL_AMBULANCE_SVG = `<svg viewBox="0 0 64 96" fill="none" shape-rendering="crispEdges" aria-hidden="true" focusable="false">${PARTS.map(([d, fill]) => `<path d="${d}" fill="${fill}"/>`).join("")}</svg>`;
