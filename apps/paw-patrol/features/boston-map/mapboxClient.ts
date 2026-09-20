/** Lazy browser-only dependency boundary, isolated for lifecycle testing. */
export async function loadMapbox() {
  return (await import("mapbox-gl")).default;
}
