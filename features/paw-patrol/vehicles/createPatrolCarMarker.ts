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
  // Static black-and-white sedan artwork, shared by every unit. Only the
  // red/blue lightbar is coloured; no unit palette or external asset is used.
  element.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="44" viewBox="0 0 64 88" fill="none" aria-hidden="true" focusable="false">
    <rect data-car-outline x="7" y="1" width="50" height="86" rx="18" stroke-width="2"/>
    <path d="M14 28H9c-2 0-3 2-3 4v3h9m34-7h6c2 0 3 2 3 4v3h-9" fill="#202226" stroke="#f8fafc" stroke-width="1.5"/>
    <path d="M22 4h20c7 0 10 5 10 13v48c0 13-7 19-20 19S12 78 12 65V17C12 9 15 4 22 4Z" fill="#25272a" stroke="#f8fafc" stroke-width="2"/>
    <path d="M22 6h20c5 0 7 3 7 9v5c-10-2-24-2-34 0v-5c0-6 2-9 7-9Z" fill="#414448"/>
    <path d="M17 21c8-2 22-2 30 0l2 42c-9 7-25 7-34 0l2-42Z" fill="#f1f3f5"/>
    <path d="M20 23c7-1 17-1 24 0 3 0 4 2 3 5l-3 7c-8-1-16-1-24 0l-3-7c-1-3 0-5 3-5Z" fill="#354257" stroke="#202b3a" stroke-width="1.3"/>
    <path d="m17 35 3 3v8h-4l1-11Zm30 0-3 3v8h4l-1-11ZM16 49h4v11l-4 3V49Zm32 0h-4v11l4 3V49Z" fill="#354257"/>
    <rect x="20" y="41" width="24" height="5" rx="1" fill="#202226"/>
    <path d="M21 41h11v5H21z" fill="#4b91df"/>
    <path d="M32 41h11v5H32z" fill="#ef253c"/>
    <path d="M23 57c6 1 12 1 18 0l6 7c-8 7-22 7-30 0l6-7Z" fill="#354257" stroke="#202b3a" stroke-width="1.3"/>
    <path d="M21 71c6-2 16-2 22 0l-3 7c-4 2-12 2-16 0l-3-7Z" fill="#414448"/>
    <path d="M17 12h5m20 0h5M16 74l3 5m29-5-3 5" stroke="#cbd0d5" stroke-width="2" stroke-linecap="round"/>
  </svg>`;
  return element;
}
