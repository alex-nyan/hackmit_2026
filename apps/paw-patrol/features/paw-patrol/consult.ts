import { PEOPLE, type Person, stamp } from "./scenario";

export type SceneStatus = "unknown" | "unsafe" | "cleared";
export type SceneReport = { status: SceneStatus; at: number; source: "Demo operator" | "Scripted command report" };
export type PanicReport = { personId: Person["id"]; at: number; acknowledgedAt: number | null };
export type ConsultEvent = { id: string; at: number; title: string; detail: string; source: string };
export type Avpu = "Not assessed" | "Alert" | "Responds to voice" | "Responds to pain" | "Unresponsive";
export type MistRecord = {
  mechanism: string; injuries: string; symptoms: string;
  bpMethod: "Not measured" | "Cuff" | "Palpated systolic";
  systolic: string; diastolic: string;
  pulse: "Not assessed" | "Present" | "Absent"; pulseSite: string;
  consciousness: Avpu; treatments: string; reporter: string; at: number;
};
export const AVPU: Avpu[] = ["Not assessed", "Alert", "Responds to voice", "Responds to pain", "Unresponsive"];
export function isPersonId(id: string): id is Person["id"] { return PEOPLE.some(p => p.id === id); }
export function sceneAt(time: number, override: SceneReport | null): SceneReport {
  if (override) return override;
  if (time >= 56) return { status: "cleared", at: 56, source: "Scripted command report" };
  return { status: time >= 15 ? "unsafe" : "unknown", at: time >= 15 ? 15 : 0, source: "Scripted command report" };
}
export function emsStatus(time: number, scene: SceneStatus) {
  if (time >= 90) return "Handoff complete";
  if (time >= 60) return "In transport";
  if (time < 45) return "Not requested";
  if (time < 52) return "Requested · awaiting assignment";
  return scene === "cleared" ? "Patient access authorized in demo" : "Staging · no scene entry";
}
export function emptyMist(time: number): MistRecord {
  return { mechanism: "Reported gunshot — scripted scenario", injuries: "", symptoms: "", bpMethod: "Not measured", systolic: "", diastolic: "", pulse: "Not assessed", pulseSite: "", consciousness: "Not assessed", treatments: "", reporter: "Scripted scenario", at: Math.min(time, 45) };
}
export function bloodPressure(record: MistRecord) {
  if (record.bpMethod === "Not measured" || !record.systolic) return "Not measured";
  return record.bpMethod === "Palpated systolic" ? `${record.systolic} mmHg systolic · palpated` : `${record.systolic}/${record.diastolic || "—"} mmHg · cuff`;
}
export function validateMist(record: MistRecord): string | null {
  if (record.bpMethod !== "Not measured") {
    if (!/^\d{1,3}$/.test(record.systolic) || Number(record.systolic) <= 0) return "Enter a measured systolic pressure, or choose Not measured.";
    if (record.bpMethod === "Cuff" && (!/^\d{1,3}$/.test(record.diastolic) || Number(record.diastolic) <= 0)) return "Enter both cuff readings, or choose Not measured.";
    if (record.bpMethod === "Cuff" && Number(record.diastolic) >= Number(record.systolic)) return "Check the cuff readings: diastolic must be below systolic.";
  }
  return null;
}
export function mistText(person: Person, record: MistRecord, heartRate: number, time: number, scene: SceneReport) {
  return [`SIMULATED MIST · ${person.name} · ${person.id}`, `Scene: ${scene.status} (${scene.source}, ${stamp(scene.at)})`, `M — Mechanism: ${record.mechanism || "Not reported"}`, `I — Injuries: ${record.injuries || "Not described"}`, `S — Signs: HR ${heartRate} bpm (synthetic, ${stamp(time)}); BP ${bloodPressure(record)}; pulse ${record.pulse.toLowerCase()}${record.pulseSite ? ` at ${record.pulseSite}` : ""}; AVPU ${record.consciousness}; symptoms ${record.symptoms || "Not recorded"}`, `T — Treatments/interventions: ${record.treatments || "Not recorded — do not assume none"}`, `Record source: ${record.reporter}, ${stamp(record.at)}. No real patient data or external handoff.`].join("\n");
}
