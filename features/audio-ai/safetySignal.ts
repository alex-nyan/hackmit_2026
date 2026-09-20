/** Deliberately broad phrase review, independent of the LLM and its confidence. */
export interface AudioSafetySignal {
  level: "urgent" | "review";
  matches: string[];
  transcript: string;
  input_kind: "microphone" | "manual";
  assessment_id: string;
}

const URGENT =
  /\b(?:bomb(?:s|ing)?|explod(?:e[sd]?|ing)|explosi(?:on[s]?|ve[s]?)|detonat(?:e[sd]?|ing|ion)|blow\s+(?:\w+\s+){0,3}up|shoot(?:ing)?|shot[s]?\s+fired|gunfire|kill(?:ing)?|stab(?:bed|bing)?|officer\s+down|(?:need|send|request(?:ing)?)\s+(?:\w+\s+){0,2}backup)\b/gi;
const REVIEW =
  /\b(?:gun[s]?|knife|knives|weapon[s]?|firearm[s]?|pistol[s]?|rifle[s]?|machete[s]?|hostage[s]?|help\s+me|can(?:not|'t|’t)\s+breathe|bleeding|threaten(?:ing|ed)?)\b/gi;

export function detectSafetyPhrase(
  text: string,
): Pick<AudioSafetySignal, "level" | "matches"> | null {
  // Negation, quotes and "training" intentionally do not suppress this review
  // trigger. A person resolves it; this is not an assertion of a real threat.
  const urgent = [...text.matchAll(URGENT)].map((match) => match[0]);
  const review = [...text.matchAll(REVIEW)].map((match) => match[0]);
  const matches = [...new Set([...urgent, ...review])].slice(0, 8);
  return matches.length ? { level: urgent.length ? "urgent" : "review", matches } : null;
}

export function safetySignalLabel(signal: AudioSafetySignal) {
  return signal.level === "urgent"
    ? "Urgent phrase alert — verify now"
    : "Safety phrase alert — review needed";
}

export function parseAudioSafetySignal(value: unknown): AudioSafetySignal | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (
    !["urgent", "review"].includes(String(raw.level)) ||
    !["microphone", "manual"].includes(String(raw.input_kind)) ||
    typeof raw.transcript !== "string" ||
    !raw.transcript.trim() ||
    raw.transcript.length > 4000 ||
    typeof raw.assessment_id !== "string" ||
    !/^audio-ai-[a-f0-9]{32}$/.test(raw.assessment_id)
  )
    return null;
  const detected = detectSafetyPhrase(raw.transcript);
  if (!detected || detected.level !== raw.level) return null;
  return {
    ...detected,
    transcript: raw.transcript,
    input_kind: raw.input_kind as AudioSafetySignal["input_kind"],
    assessment_id: raw.assessment_id,
  };
}
