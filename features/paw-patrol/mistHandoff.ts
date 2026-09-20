import type { BodyObservation } from "../anatomy/bodyEvidence";
import type { HeartRateConnection } from "../heart-rate/useHeartRate";
import type { IncidentEvent } from "./incidents";

export interface MistEntry {
  id: string;
  text: string;
  source: string;
  at: string | null;
  state: "current" | "stale" | "sample";
  review: boolean;
  priority: boolean;
  confidence: number | null;
  sourceId: string;
}

export interface MistField {
  id: string;
  label: string;
  entries: MistEntry[];
}

export interface MistSection {
  id: "mechanism" | "signs" | "treatment";
  code: "M + I" | "S" | "T";
  title: string;
  fields: MistField[];
}

type FieldId =
  | "mechanism"
  | "injury"
  | "heartRate"
  | "bloodPressure"
  | "pulse"
  | "avpu"
  | "interventions"
  | "medications"
  | "fluids";

type ReportPart = {
  text: string;
  value: string;
  preface: string;
  section: "M" | "I" | "MI" | "S" | "T" | null;
  field?: FieldId;
};

const MAX_ENTRIES = 3;
const MECHANISM =
  /\b(?:mechanism|moi|fall(?:s|en|ing)?|fell|collision|crash(?:ed)?|mvc|mva|rtc|rta|struck|hit by|assault|stabb(?:ed|ing)|gunshots?|shots? fired|gsw|explosion|blast|electrocut(?:ed|ion)|scald(?:ed|ing)?|drown(?:ed|ing)|crush(?:ed|ing)|penetrat(?:ing|ion))\b|\b(?:was|been|got|being) shot\b/i;
const INJURY =
  /\b(?:injur(?:y|ies|ed)|wounds?|gsw|bleed(?:ing|s)?|ha?emorrhag(?:e|ing)|fractur(?:e|ed|es)|lacerations?|bruis(?:e|es|ing)|contusions?|swelling|swollen|pain|burn(?:s|ed|t)?|amputat(?:ion|ed)|dislocat(?:ion|ed))\b|\bcut (?:on|over|in)\b|\b(?:was|been|got|being) shot\b/i;
const HEART_RATE = /\bheart[- ]rate\b|\bhr(?=\b|\d)|\b\d+(?:\.\d+)?\s*(?:bpm|beats? per minute)\b/i;
const BLOOD_PRESSURE =
  /\b(?:blood pressure|systolic|diastolic)\b|\bbp(?=\b|\d)|\b\d{2,3}\s*\/\s*\d{2,3}\s*mm\s*hg\b/i;
const PULSE = /\bpulse\b(?!\s+ox(?:imeter|imetry)\b)/i;
const AVPU =
  /\b(?:avpu|unconscious|consciousness|unresponsive|responsive to (?:voice|pain)|respond(?:s|ing)? to (?:voice|verbal|pain))\b|\balert and (?:oriented|responsive)\b|\b(?:patient|person|officer|subject|he|she|they)\s+(?:(?:is|was|are|were|appears?|seems?)\s+)?(?:fully\s+)?(?:alert|awake|conscious)\b/i;
const INTERVENTIONS =
  /\b(?:treatments?|interventions?|tourniquets?|chest seals?|cpr|resuscitation|defibrillat(?:ion|ed|or)|aed|oxygen|o2|bandag(?:e|es|ed|ing)|dressings?|direct pressure|splint(?:s|ed|ing)?|intubat(?:ion|ed)|airway|ventilat(?:ion|ed)|rescue breaths?|immobili[sz](?:ation|ed)|chest compressions?|suction|wound pack(?:ing|ed))\b/i;
const MEDICATIONS =
  /\b(?:medications?|medicines?|drugs?|analgesi(?:a|cs?)|antibiotics?|naloxone|narcan|adrenaline|epinephrine|morphine|fentanyl|ketamine|paracetamol|acetaminophen|aspirin|ibuprofen|tranexamic acid|txa|salbutamol|albuterol|nitroglycerin|glyceryl trinitrate|glucagon|insulin|amiodarone|atropine)\b/i;
const FLUIDS =
  /\b(?:saline|lactated ringer'?s?|hartmann'?s?|crystalloids?|colloids?|blood transfusion|packed red blood|prbc)\b|\b(?:iv|intravenous|io|intraosseous)\s+(?:fluids?|bolus|infusion)\b|\bfluids?\s+(?:given|administered|started|requested|planned|running|withheld|not|yet)\b|\b(?:no|give|given|administer|requested?|planned?)\s+fluids?\b/i;
const UNKNOWN_VALUE =
  /^(?:unknown|not (?:reported|assessed|available|measured|recorded|documented|known|provided)|unavailable|unconfirmed|not yet (?:reported|assessed|measured|known)|n\/?a|[-—–?])\s*[.!?]?$/i;
const SUBFIELDS: Record<string, FieldId> = {
  "heart rate": "heartRate",
  "heart-rate": "heartRate",
  hr: "heartRate",
  "blood pressure": "bloodPressure",
  bp: "bloodPressure",
  pulse: "pulse",
  avpu: "avpu",
  intervention: "interventions",
  interventions: "interventions",
  medication: "medications",
  medications: "medications",
  medicine: "medications",
  medicines: "medications",
  fluid: "fluids",
  fluids: "fluids",
};

/** Remove only the two exact transcript wrappers emitted by our publishers. */
function transcriptText(detail: string): string {
  const text = detail.trim();
  // The publisher can truncate its final boilerplate to its 600-character limit.
  // Its exact closing-quote delimiter still separates speech from matched terms.
  const quoted = /^Transcript hypothesis: "([\s\S]*)"\. Matched terms: /.exec(text);
  if (quoted) return quoted[1].trim();
  const plain = /^Transcript hypothesis: ([\s\S]*)\. Confirm with the crew\.$/.exec(text);
  return plain ? plain[1].trim() : text;
}

/**
 * Only explicit MIST labels establish a boundary. Ordinary sentences, questions,
 * quotations and negations remain intact. A prefatory qualifier stays with every
 * labelled part, e.g. "Hypothetical example, not observed: ...".
 */
function reportParts(text: string): ReportPart[] {
  const pattern =
    /(?:^|[\n;])\s*(M\s*\+\s*I|M|I|S|T|Mechanism(?:\s+of\s+injury)?|Injury|Injuries|Signs|Treatment)\s*:\s*/gi;
  const labels = [...text.matchAll(pattern)];
  if (!labels.length) return [{ text, value: text, section: null, preface: "" }];
  const preface = text.slice(0, labels[0].index).trim();
  const parts: ReportPart[] = preface
    ? [{ text: preface, value: preface, section: null, preface: "" }]
    : [];
  return parts.concat(
    labels.flatMap((match, index) => {
      const value = text.slice(match.index! + match[0].length, labels[index + 1]?.index).trim();
      if (!value) return [];
      const label = match[1].toUpperCase();
      const section: ReportPart["section"] = label.includes("+")
        ? "MI"
        : label.startsWith("M")
          ? "M"
          : label.startsWith("I")
            ? "I"
            : label.startsWith("S")
              ? "S"
              : "T";
      return [
        {
          text: [preface, `${match[1]}: ${value}`].filter(Boolean).join("\n"),
          value,
          section,
          preface,
        },
      ];
    }),
  );
}

/** Subdivide explicit field labels only; keep ordinary prose and its qualifiers. */
function subfieldParts(part: ReportPart): ReportPart[] {
  const pattern =
    /(?:^|[\n;])\s*(Heart[- ]rate|HR|Blood pressure|BP|Pulse|AVPU|Interventions?|Medications?|Medicines?|Fluids?)\s*:\s*/gi;
  const labels = [...part.value.matchAll(pattern)];
  if (!labels.length) return [part];
  const leading = part.value.slice(0, labels[0].index).trim();
  const preface = [part.preface, leading].filter(Boolean).join("\n");
  const parts: ReportPart[] = leading
    ? [
        {
          text: [part.preface, leading].filter(Boolean).join("\n"),
          value: leading,
          preface: part.preface,
          section: part.section,
        },
      ]
    : [];
  return parts.concat(
    labels.flatMap((match, index) => {
      const value = part.value
        .slice(match.index! + match[0].length, labels[index + 1]?.index)
        .trim();
      if (!value || UNKNOWN_VALUE.test(value)) return [];
      return [
        {
          text: [preface, `${match[1]}: ${value}`].filter(Boolean).join("\n"),
          value,
          preface,
          section: part.section,
          field: SUBFIELDS[match[1].toLowerCase()],
        },
      ];
    }),
  );
}

/** Never promote a named supply, question or planned action to completed care. */
function treatmentText(part: ReportPart): string | null {
  const context = [part.preface, part.value].filter(Boolean).join("\n");
  const planned =
    /\b(?:request(?:ed|s|ing)?|plan(?:ned|s|ning)?|recommend(?:ed|s)?|need(?:ed|s)?|await(?:ing)?|consider(?:ing)?|intend(?:ed|s)?|will|should|would|could|to be)\b|\b(?:apply|administer|give|start|place|insert)\b/i.test(
      context,
    );
  // Exclude negated or future completion verbs only for this decision. The
  // displayed source wording is never rewritten or stripped of those words.
  const completionContext = context.replace(
    /\b(?:not|never|hasn['’]t|haven['’]t|wasn['’]t|weren['’]t|isn['’]t|aren['’]t|to be|will be|should be|would be|could be|may be|might be)\s+(?:(?:yet|been|being|actually|already|ever)\s+)*(?:applied|administered|given|started|placed|inserted|performed|completed|received|underway|running|in place)\b/gi,
    "",
  );
  const completed =
    /\b(?:applied|administered|given|started|placed|inserted|performed|completed|received|underway|running|in place)\b/i.test(
      completionContext,
    );
  if (context.includes("?") && !planned) return null;
  if (planned && !completed) return `Planned / requested: ${part.text}`;
  if (completed) return part.text;
  // An explicit absence is a report too; it must retain its negative wording.
  if (/\b(?:none|no|not|never|declined|refused|withheld)\b/i.test(context)) return part.text;
  return null;
}

/** These are topic matches for verbatim reports, never parsed medical findings. */
function fieldsFor(part: ReportPart, sharedHeartRate: boolean): FieldId[] {
  if (UNKNOWN_VALUE.test(part.value)) return [];
  if (part.field) return [part.field];
  const fields = new Set<FieldId>();
  const text = part.value;
  const general = part.section === null;
  if (part.section === "M" || part.section === "MI") fields.add("mechanism");
  if (part.section === "I" || part.section === "MI") fields.add("injury");
  if (general && MECHANISM.test(text)) fields.add("mechanism");
  if (general && INJURY.test(text)) fields.add("injury");
  if (general || part.section === "S") {
    if (HEART_RATE.test(text) || sharedHeartRate) fields.add("heartRate");
    if (BLOOD_PRESSURE.test(text)) fields.add("bloodPressure");
    if (PULSE.test(text)) fields.add("pulse");
    if (AVPU.test(text) || (part.section === "S" && /\b(?:alert|awake|conscious)\b/i.test(text)))
      fields.add("avpu");
  }
  if (general || part.section === "T") {
    if (INTERVENTIONS.test(text)) fields.add("interventions");
    if (MEDICATIONS.test(text)) fields.add("medications");
    if (FLUIDS.test(text) || (part.section === "T" && /\bfluids?\b/i.test(text)))
      fields.add("fluids");
    if (part.section === "T" && fields.size === 0) fields.add("interventions");
  }
  return [...fields];
}

function sourceLabel(
  observation: BodyObservation,
  event: IncidentEvent | undefined,
  audio: boolean,
): string {
  if (observation.state === "sample" || observation.origin === "script")
    return `Sample · ${observation.source}`;
  if (audio) return `Audio transcript · speaker unverified · ${observation.source}`;
  if (event?.kind === "vitals") return `Shared vital snapshot · ${observation.source}`;
  if (event?.kind === "observation" || (event?.kind === "hazard" && !/^Audio\b/i.test(event.title)))
    return `Video report · ${observation.source}`;
  return `${observation.origin === "model" ? "Model report" : "Operator report"} · ${observation.source}`;
}

function sourceConfidence(observation: BodyObservation, event: IncidentEvent | undefined) {
  // language_probability belongs to language identification, never claim accuracy.
  if (event?.kind === "transcript" || observation.origin !== "model") return null;
  const score = observation.confidence;
  return typeof score === "number" && Number.isFinite(score) && score >= 0 && score <= 1
    ? score
    : null;
}

function boundEntries(entries: MistEntry[]): MistEntry[] {
  const rank = { current: 0, stale: 1, sample: 2 };
  const seen = new Set<string>();
  return entries
    .sort(
      (a, b) =>
        rank[a.state] - rank[b.state] ||
        (b.at === null ? 0 : Date.parse(b.at)) - (a.at === null ? 0 : Date.parse(a.at)),
    )
    .filter((entry) => {
      const key = `${entry.sourceId}\0${entry.source}\0${entry.text.toLowerCase().replace(/\s+/g, " ")}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_ENTRIES);
}

/**
 * Patient/source scoping and offline freshness belong to getBodyObservations.
 * The supplied observations are the allowlist; a matching event only contributes
 * kind/review metadata. Unrelated events never become handoff content. Unknown
 * fields remain empty, and no scene/dispatch action becomes a treatment.
 */
export function buildMistHandoff({
  observations,
  events,
  heartRate,
  now,
}: {
  observations: readonly BodyObservation[];
  events: readonly IncidentEvent[];
  heartRate: HeartRateConnection | null;
  now: number | null;
}): MistSection[] {
  const sections: MistSection[] = [
    {
      id: "mechanism",
      code: "M + I",
      title: "Mechanism & injuries",
      fields: [
        { id: "mechanism", label: "Mechanism", entries: [] },
        { id: "injury", label: "Injuries", entries: [] },
      ],
    },
    {
      id: "signs",
      code: "S",
      title: "Signs",
      fields: [
        { id: "heartRate", label: "Heart rate", entries: [] },
        { id: "bloodPressure", label: "Blood pressure", entries: [] },
        { id: "pulse", label: "Pulse", entries: [] },
        { id: "avpu", label: "AVPU", entries: [] },
      ],
    },
    {
      id: "treatment",
      code: "T",
      title: "Treatment",
      fields: [
        { id: "interventions", label: "Interventions", entries: [] },
        { id: "medications", label: "Medications", entries: [] },
        { id: "fluids", label: "Fluids", entries: [] },
      ],
    },
  ];
  const fields = new Map(
    sections.flatMap((section) => section.fields.map((field) => [field.id, field] as const)),
  );
  const eventById = new Map(events.map((event) => [event.id, event]));
  for (const observation of observations) {
    const matchingEvent = eventById.get(observation.id);
    const event = matchingEvent?.personId === observation.personId ? matchingEvent : undefined;
    if (event && ["scene", "acknowledge"].includes(event.kind)) continue;
    const audio =
      event?.kind === "transcript" || /^Transcript hypothesis: /.test(observation.detail);
    const text = audio ? transcriptText(observation.detail) : observation.detail.trim();
    if (!text) continue;
    const at = Number.isFinite(Date.parse(observation.at)) ? observation.at : null;
    const sample = observation.state === "sample" || observation.origin === "script";
    const state: MistEntry["state"] = sample
      ? "sample"
      : observation.state === "current" &&
          at !== null &&
          now !== null &&
          Number.isFinite(now) &&
          Date.parse(at) <= now &&
          now - Date.parse(at) <= (event?.kind === "vitals" ? 30_000 : 60_000)
        ? "current"
        : "stale";
    // The existing operator-share action publishes this exact device snapshot
    // envelope. Never extract a numerical vital from ordinary narrative prose.
    const sharedReading =
      event?.kind === "vitals" &&
      event.origin === "operator" &&
      event.source === "Operator-shared Bluetooth"
        ? /^(\d+) bpm from .+\. Browser receipt time (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\. Wearer assigned by operator; not independently verified\.$/.exec(
            text,
          )
        : null;
    const sharedPriority =
      state === "current" &&
      sharedReading !== null &&
      at !== null &&
      Date.parse(sharedReading[2]) === Date.parse(at) &&
      Number(sharedReading[1]) > 90 &&
      Number(sharedReading[1]) <= 65_535;
    reportParts(text)
      .flatMap(subfieldParts)
      .forEach((part, index) => {
        for (const fieldId of fieldsFor(
          part,
          event?.kind === "vitals" && /^\d+\s+bpm from\b/i.test(text),
        )) {
          const entryText = ["interventions", "medications", "fluids"].includes(fieldId)
            ? treatmentText(part)
            : part.text;
          if (entryText === null) continue;
          fields.get(fieldId)!.entries.push({
            id: `${observation.id}:${index}:${fieldId}`,
            text: entryText,
            source: sourceLabel(observation, event, audio),
            at,
            state,
            review: observation.origin === "model" || (event?.requiresHumanReview ?? false),
            priority: fieldId === "heartRate" && sharedPriority,
            confidence: audio ? null : sourceConfidence(observation, event),
            sourceId: observation.personId,
          });
        }
      });
  }

  for (const field of fields.values()) field.entries = boundEntries(field.entries);

  if (
    heartRate?.mode === "device" &&
    heartRate.status === "receiving" &&
    heartRate.bpm !== null &&
    Number.isInteger(heartRate.bpm) &&
    heartRate.bpm > 0 &&
    heartRate.bpm <= 65_535 &&
    heartRate.receivedAt !== null &&
    Number.isFinite(heartRate.receivedAt) &&
    now !== null &&
    Number.isFinite(now) &&
    now >= heartRate.receivedAt &&
    now - heartRate.receivedAt <= 30_000
  ) {
    const date = new Date(heartRate.receivedAt);
    if (Number.isFinite(date.getTime())) {
      const heartRateField = fields.get("heartRate")!;
      heartRateField.entries.unshift({
        id: `device-heart-rate:${heartRate.receivedAt}`,
        text: `${heartRate.bpm} bpm`,
        source: `${heartRate.deviceName ?? "Bluetooth device"} · operator-assigned wearer`,
        at: date.toISOString(),
        state: "current",
        review: false,
        priority: heartRate.bpm > 90,
        confidence: null,
        sourceId: "local-device",
      });
      // A current measured value must remain visible even when several newer
      // prose reports also mention heart rate.
      heartRateField.entries = heartRateField.entries.slice(0, MAX_ENTRIES);
    }
  }
  return sections;
}
