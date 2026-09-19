export type MapTheme = "light" | "dark";

export type MapStatus = "loading" | "ready" | "error" | "missing-token";

export const MAP_FOCUS = {
  all: {
    label: "All Boston",
    center: [-71.092, 42.3615] as [number, number],
    zoom: 12.7,
  },
  mit: {
    label: "MIT",
    center: [-71.0921, 42.3601] as [number, number],
    zoom: 16.1,
  },
  harvard: {
    label: "Harvard",
    center: [-71.1165, 42.3744] as [number, number],
    zoom: 15.9,
  },
  boston: {
    label: "Boston",
    center: [-71.0715, 42.355] as [number, number],
    zoom: 15.4,
  },
} as const;

export type MapFocus = keyof typeof MAP_FOCUS;
