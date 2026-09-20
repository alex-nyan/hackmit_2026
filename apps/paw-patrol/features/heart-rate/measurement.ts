/** Bluetooth SIG Heart Rate Measurement (0x2A37), not a clinical assessment. */
export type HeartRateMeasurement =
  | { kind: "reading"; bpm: number }
  | { kind: "no-contact" }
  | { kind: "invalid" };

export function parseHeartRateMeasurement(value?: DataView | null): HeartRateMeasurement {
  try {
    return parseMeasurement(value);
  } catch {
    // A detached buffer or malformed browser event must never preserve old live data.
    return { kind: "invalid" };
  }
}

function parseMeasurement(value?: DataView | null): HeartRateMeasurement {
  if (!value || value.byteLength < 2) return { kind: "invalid" };
  const flags = value.getUint8(0);
  const wide = (flags & 0x01) !== 0;
  let required = wide ? 3 : 2;
  if (flags & 0x08) required += 2; // Optional Energy Expended value.
  if (value.byteLength < required) return { kind: "invalid" };
  const remaining = value.byteLength - required;
  if (flags & 0x10) {
    if (remaining < 2 || remaining % 2 !== 0) return { kind: "invalid" };
  } else if (remaining !== 0) {
    return { kind: "invalid" };
  }
  if ((flags & 0x04) !== 0 && (flags & 0x02) === 0) return { kind: "no-contact" };
  const bpm = wide ? value.getUint16(1, true) : value.getUint8(1);
  // Zero is not a usable pulse sample. Do not infer anything medical from it.
  return bpm === 0 ? { kind: "invalid" } : { kind: "reading", bpm };
}
