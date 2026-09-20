import "server-only";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { IncidentDraft, IncidentEvent } from "./incidents";

/** Explicit local demo storage shared by all three Next processes. Never used on Vercel. */
export function usesLocalIncidents() {
  return process.env.PAW_PATROL_INCIDENT_STORE === "local" && !process.env.VERCEL;
}
// Runtime data is provisioned on the host, never bundled from the developer's machine.
const directory = () =>
  path.resolve(/* turbopackIgnore: true */ process.env.PAW_PATROL_LOCAL_DATA_DIR || ".runtime");
const filename = () => path.join(directory(), "incidents.json");

export async function readLocalIncidents(): Promise<IncidentEvent[]> {
  try {
    const value: unknown = JSON.parse(await readFile(filename(), "utf8"));
    if (!Array.isArray(value)) throw new Error("Invalid local incident log");
    return value as IncidentEvent[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function locked<T>(operation: () => Promise<T>): Promise<T> {
  await mkdir(directory(), { recursive: true, mode: 0o700 });
  const lock = path.join(directory(), "incidents.lock");
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      await mkdir(lock, { mode: 0o700 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      await new Promise((resolve) => setTimeout(resolve, 30));
      continue;
    }
    try {
      return await operation();
    } finally {
      await rm(lock, { recursive: true, force: true });
    }
  }
  throw new Error(
    "Local incident store is busy; check .runtime/incidents.lock if a process was interrupted.",
  );
}

export async function appendLocalIncident(draft: IncidentDraft, now: Date): Promise<IncidentEvent> {
  return locked(async () => {
    const events = await readLocalIncidents();
    const existing = events.find((item) => item.id === draft.id);
    if (existing) return existing;
    const event = { ...draft, seq: (events.at(-1)?.seq ?? 0) + 1, at: now.toISOString() };
    const temporary = `${filename()}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify([...events, event].slice(-200)), { mode: 0o600 });
    await rename(temporary, filename());
    return event;
  });
}

export async function clearLocalIncidents() {
  await locked(() => rm(filename(), { force: true }));
}
