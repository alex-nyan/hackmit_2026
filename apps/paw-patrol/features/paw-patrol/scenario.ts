export type View = "command" | "officer" | "hospital";
export type Point = [number, number];
export const DURATION = 90;
export const PHASES = [
  {
    at: 0,
    label: "Patrol",
    title: "Every officer. In view.",
    detail:
      "Units are on their assigned patrols. No active incidents in this scenario.",
  },
  {
    at: 15,
    label: "Signal",
    title: "A signal worth attention.",
    detail:
      "A scripted camera event reports a possible weapon. Unverified; no injury reported.",
  },
  {
    at: 30,
    label: "Backup",
    title: "Support is on its way.",
    detail:
      "Two nearby units are automatically assigned in the simulation. No radio request needed.",
  },
  {
    at: 45,
    label: "Medical",
    title: "A coordinated response.",
    detail:
      "The scenario introduces an explicit injury report. This is not inferred from heart rate.",
  },
  {
    at: 60,
    label: "Transport",
    title: "Care starts before arrival.",
    detail:
      "The simulated ambulance transports the officer. The receiving team can review the handoff.",
  },
  {
    at: 75,
    label: "Handoff",
    title: "One continuous picture.",
    detail:
      "The simulated receiving team has the event timeline and sample observations.",
  },
] as const;
export const INCIDENT: Point = [...DEMO_INCIDENT];
export const DESTINATION: Point = [...DEMO_DESTINATION];
export const ROUTE: Point[] = VEHICLE_ROUTES.find((route) => route.id === "p-01-transport")?.coordinates ?? [];
export const PEOPLE = [
  {
    id: "P-01",
    name: "Alex Morgan",
    initials: "AM",
    role: "Patrol officer",
    area: "Kendall Square",
    point: vehicleAt("P-01", 0).point,
    color: "butter",
  },
  {
    id: "P-02",
    name: "Jordan Lee",
    initials: "JL",
    role: "Response officer",
    area: "MIT campus",
    point: vehicleAt("P-02", 0).point,
    color: "sage",
  },
  {
    id: "P-03",
    name: "Sam Rivera",
    initials: "SR",
    role: "Response officer",
    area: "Kendall Square",
    point: vehicleAt("P-03", 0).point,
    color: "sky",
  },
  {
    id: "P-04",
    name: "Taylor Brooks",
    initials: "TB",
    role: "Patrol officer",
    area: "Harvard Square",
    point: vehicleAt("P-04", 0).point,
    color: "lavender",
  },
] as const;
export type Person = (typeof PEOPLE)[number];
export const EVENTS = [
  {
    at: 0,
    title: "Patrol scenario ready",
    detail: "Four synthetic officers around Cambridge.",
    source: "Scenario",
  },
  {
    at: 15,
    title: "Possible weapon · unverified",
    detail: "Scripted camera signal from P-01. No actual footage received.",
    source: "Camera sample",
  },
  {
    at: 22,
    title: "Sample audio concern",
    detail: "Scripted call for assistance. No microphone connected.",
    source: "Audio sample",
  },
  {
    at: 30,
    title: "Backup assigned automatically",
    detail: "P-02 and P-03 respond to the sample location.",
    source: "Demo automation",
  },
  {
    at: 45,
    title: "Explicit staged injury report",
    detail: "Scripted report of a gunshot injury to P-01. Injury site and clinical status unknown.",
    source: "Scenario",
  },
  {
    at: 52,
    title: "Medical response assigned",
    detail: "EMS-01 stages outside the incident. Assignment does not authorize entry.",
    source: "Demo automation",
  },
  {
    at: 56,
    title: "Scripted scene clearance reported",
    detail: "A separate simulated command report authorizes patient access. Not an AI assessment.",
    source: "Scripted command report",
  },
  {
    at: 60,
    title: "Simulated transport underway",
    detail: "Sample handoff available to the receiving desk.",
    source: "Demo automation",
  },
  {
    at: 75,
    title: "Receiving team notified in demo",
    detail: "Summary displayed locally. No hospital was contacted.",
    source: "Demo automation",
  },
  {
    at: 90,
    title: "Handoff complete",
    detail: "Scenario finished. No real dispatches or external messages.",
    source: "Scenario",
  },
] as const;
export function clampTime(value: number) {
  return Number.isFinite(value) ? Math.min(DURATION, Math.max(0, value)) : 0;
}
export function phaseAt(time: number) {
  const t = clampTime(time);
  return PHASES.reduce((phase, p, i) => (t >= p.at ? i : phase), 0);
}
export function nextTime(time: number) {
  return PHASES.find((p) => p.at > clampTime(time))?.at ?? DURATION;
}
export function stamp(time: number) {
  const t = Math.floor(clampTime(time));
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}
export function sampleHeartRate(id: string, time: number) {
  return id === "P-01"
    ? [78, 108, 118, 132, 124, 112][phaseAt(time)]
    : id === "P-02"
      ? 82
      : id === "P-03"
        ? 76
        : 80;
}
export function personStatus(id: string, time: number) {
  const phase = phaseAt(time);
  if (id === "P-01")
    return [
      "On patrol",
      "Needs attention",
      "Backup responding",
      "Staged injury",
      "In transport",
      "Handoff",
    ][phase];
  if ((id === "P-02" || id === "P-03") && phase >= 2)
    return phase >= 3 ? "At scene" : "Responding";
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
import { DEMO_DESTINATION, DEMO_INCIDENT, VEHICLE_ROUTES, pointAtDistance, prepareRouteGeometry, vehicleAt } from "./vehicles/vehicleMotion";
