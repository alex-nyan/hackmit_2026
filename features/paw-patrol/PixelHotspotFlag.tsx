import type { SVGProps } from "react";

const FLAG_OUTLINE = "M5 2h4v2h12v2h7V4h3v18h-3v2h-9v-2H9v17H3V4h2Z";
const FLAG_CLOTH = "M9 7h11v2h8v12h-8v-2H9Z";

/** Shared, original pixel artwork for the demo tool and native map markers. */
export function PixelHotspotFlag(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 34 42" fill="none" shapeRendering="crispEdges" aria-hidden="true" {...props}>
      <path d={FLAG_OUTLINE} fill="#241d20" />
      <path d="M5 5h2v31H5Z" fill="#d8b17e" />
      <path d="M7 5h2v31H7Z" fill="#8f6647" />
      <path d={FLAG_CLOTH} fill="#f23645" />
      <path d="M9 7h11v2h8v3h-9v-2H9Z" fill="#ff7074" />
      <path d="M9 17h11v2h8v2h-8v-2H9Z" fill="#c92036" />
      <path d="M2 39h9v2H2Z" fill="#241d20" />
    </svg>
  );
}

/** Static trusted artwork only; never concatenate user or model content here. */
export const PIXEL_HOTSPOT_FLAG_SVG = `<svg viewBox="0 0 34 42" fill="none" shape-rendering="crispEdges" aria-hidden="true" focusable="false"><path d="${FLAG_OUTLINE}" fill="#241d20"/><path d="M5 5h2v31H5Z" fill="#d8b17e"/><path d="M7 5h2v31H7Z" fill="#8f6647"/><path d="${FLAG_CLOTH}" fill="#f23645"/><path d="M9 7h11v2h8v3h-9v-2H9Z" fill="#ff7074"/><path d="M9 17h11v2h8v2h-8v-2H9Z" fill="#c92036"/><path d="M2 39h9v2H2Z" fill="#241d20"/></svg>`;
