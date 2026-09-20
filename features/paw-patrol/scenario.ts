import {
  PATROL_UNITS,
  pointAtDistance,
  prepareRouteGeometry,
  vehicleAt,
} from "./vehicles/vehicleMotion";
export type View = "command" | "officer" | "hospital";
export type Point = [number, number];
export const PHASES = [
  { at: 0, label: "Patrol", title: "Boston patrol", detail: "15 units on patrol across Boston." },
] as const;
const names = [
  "Nyan",
  "Henry",
  "Matt",
  "Shaun",
  "Casey Chen",
  "Riley Parker",
  "Jamie Quinn",
  "Avery Reed",
  "Morgan Ellis",
  "Cameron Diaz",
  "Drew Bennett",
  "Robin Hayes",
  "Skyler Patel",
  "Charlie Kim",
  "Finley Ross",
];
/**
 * Where the scripted incident stood.
 *
 * The 90-second script that used to hang off this is gone, and nothing draws
 * the point any more. It stays because `suspects.ts` is authored relative to
 * it and its tests check that the reported track starts here — the report is
 * retained, unrendered, until there is a signal to attach it to again.
 */
export const INCIDENT: Point = [-71.090794, 42.362764];

export const PEOPLE = PATROL_UNITS.map((unit, index) => ({
  id: unit.id,
  name: names[index],
  initials: names[index]
    .split(" ")
    .map((part) => part[0])
    .join(""),
  role: "Patrol officer",
  area: unit.area,
  point: vehicleAt(unit.id, 0).point,
  color: ["butter", "sage", "sky", "lavender", "apricot"][index % 5],
}));
export type Person = (typeof PEOPLE)[number];
export const EVENTS: { at: number; title: string; detail: string; source: string }[] = [];
export function clampTime(value: number) {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}
export function phaseAt(_time: number): number {
  void _time;
  return 0;
}
/** Retained for the demo tool's seek action; never advances an incident stage. */
export function nextTime(time: number) {
  return clampTime(time) + 15;
}
export function stamp(time: number) {
  const t = Math.floor(clampTime(time));
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}
export function sampleHeartRate(id: string, _time: number) {
  void _time;
  return [78, 82, 76, 80][
    Math.max(
      0,
      PEOPLE.findIndex((p) => p.id === id),
    ) % 4
  ];
}
export function personStatus(_id: string, _time: number) {
  void _id;
  void _time;
  return "On patrol";
}
export function along(points: readonly Point[], fraction: number): Point {
  const geometry = prepareRouteGeometry(points);
  const progress = Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0;
  return pointAtDistance(geometry, geometry.lengthMeters * progress);
}
export function positionAt(person: Person, time: number): Point {
  return vehicleAt(person.id, time).point;
}
