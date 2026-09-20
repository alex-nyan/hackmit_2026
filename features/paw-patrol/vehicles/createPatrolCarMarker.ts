type ScreenPoint = { x: number; y: number };

/** Project the geographic heading onto the tilted/rotated map without scaling the icon. */
export function patrolCarScreenHeading(
  map: { project: (point: [number, number]) => ScreenPoint },
  point: [number, number],
  heading: number,
) {
  const radians = (heading * Math.PI) / 180;
  const forward: [number, number] = [
    point[0] + (Math.sin(radians) * 10) / (111320 * Math.cos((point[1] * Math.PI) / 180)),
    point[1] + (Math.cos(radians) * 10) / 111320,
  ];
  const start = map.project(point);
  const end = map.project(forward);
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  return Number.isFinite(dx) && Number.isFinite(dy) && Math.hypot(dx, dy) > 0.0001
    ? (Math.atan2(dx, -dy) * 180) / Math.PI
    : 0;
}

/** A screen-sized, north-facing patrol car. Mapbox handles position and heading. */
export function createPatrolCarMarker() {
  const element = document.createElement("div");
  element.setAttribute("aria-hidden", "true");
  // Static local artwork only; no device data or external assets enter the SVG.
  element.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="44" viewBox="0 0 32 44" fill="none" aria-hidden="true" focusable="false">
    <rect data-car-outline x="3" y="1" width="26" height="42" rx="10" stroke="white" stroke-width="2"/>
    <g fill="#19283b" stroke="white" stroke-width="1">
      <rect x="2" y="10" width="5" height="9" rx="2"/>
      <rect x="25" y="10" width="5" height="9" rx="2"/>
      <rect x="2" y="29" width="5" height="9" rx="2"/>
      <rect x="25" y="29" width="5" height="9" rx="2"/>
    </g>
    <path d="M12 3h8c4 0 6 4 6 9v24c0 4-2 5-5 5H11c-3 0-5-1-5-5V12c0-5 2-9 6-9Z" fill="currentColor" stroke="white" stroke-width="2"/>
    <path d="M10 8h12l1 6H9l1-6Z" fill="#fcf7ed"/>
    <path d="m9 16 3-2h8l3 2-2 6H11l-2-6Z" fill="#19334d" stroke="#b7dce8" stroke-width="1"/>
    <rect x="10" y="23" width="12" height="8" rx="2" fill="#fcf7ed"/>
    <path d="M11 33h10l2 4H9l2-4Z" fill="#19334d" stroke="#b7dce8" stroke-width="1"/>
    <rect x="9" y="23" width="7" height="3" rx="1" fill="#e46264"/>
    <rect x="16" y="23" width="7" height="3" rx="1" fill="#4ca5ef"/>
    <path d="M9 6h3m8 0h3" stroke="#fff0b5" stroke-width="2" stroke-linecap="round"/>
    <path d="M9 39h3m8 0h3" stroke="#ff9a93" stroke-width="2" stroke-linecap="round"/>
  </svg>`;
  return element;
}
