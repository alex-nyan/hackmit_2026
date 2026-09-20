/** Small, deliberately limited validator for the schema vocabulary our generator accepts. */
export class ContractValidationError extends Error {
  constructor(readonly path: string) {
    // Do not include data values: source payloads can contain private media or transcripts.
    super(`Invalid incident contract at ${path}`);
    this.name = "ContractValidationError";
  }
}

type Schema = {
  $ref?: string;
  $defs?: Record<string, Schema>;
  const?: unknown;
  enum?: unknown[];
  anyOf?: Schema[];
  oneOf?: Schema[];
  type?: string;
  properties?: Record<string, Schema>;
  required?: string[];
  additionalProperties?: boolean | Schema;
  items?: Schema;
  minItems?: number;
  maxItems?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: string;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  "x-ordered-pairs"?: string[][];
};

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validDateTime(value: string): boolean {
  const parts =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/i.exec(
      value,
    );
  if (!parts || !Number.isFinite(Date.parse(value))) return false;
  const [, year, month, day, hour, minute, second] = parts.map(Number);
  // Date.parse normalizes invalid calendar dates on some engines.
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return (
    month >= 1 && month <= 12 && day >= 1 && day <= days && hour < 24 && minute < 60 && second < 60
  );
}

function matches(schema: Schema, value: unknown, root: Schema, depth = 0): boolean {
  try {
    visit(schema, value, root, "$", depth);
    return true;
  } catch (error) {
    if (error instanceof ContractValidationError) return false;
    throw error;
  }
}

function visit(schema: Schema, value: unknown, root: Schema, path: string, depth: number): void {
  const fail = () => {
    throw new ContractValidationError(path);
  };
  if (depth > 64) fail();
  if (schema.$ref) {
    const name = schema.$ref.replace(/^#\/\$defs\//, "");
    const resolved = root.$defs?.[name];
    if (!resolved) fail();
    visit(resolved!, value, root, path, depth + 1);
    return;
  }
  if (Object.hasOwn(schema, "const") && value !== schema.const) fail();
  if (schema.enum && !schema.enum.includes(value)) fail();
  if (schema.anyOf && !schema.anyOf.some((child) => matches(child, value, root, depth + 1))) fail();
  if (
    schema.oneOf &&
    schema.oneOf.filter((child) => matches(child, value, root, depth + 1)).length !== 1
  )
    fail();
  switch (schema.type) {
    case "null":
      if (value !== null) fail();
      break;
    case "boolean":
      if (typeof value !== "boolean") fail();
      break;
    case "string": {
      if (typeof value !== "string") return fail();
      const length = Array.from(value).length;
      if (schema.minLength !== undefined && length < schema.minLength) fail();
      if (schema.maxLength !== undefined && length > schema.maxLength) fail();
      if (schema.pattern && !new RegExp(schema.pattern, "u").test(value)) fail();
      if (schema.format === "date-time" && !validDateTime(value)) fail();
      break;
    }
    case "number":
    case "integer":
      if (typeof value !== "number" || !Number.isFinite(value)) return fail();
      if (schema.type === "integer" && !Number.isSafeInteger(value)) fail();
      if (schema.minimum !== undefined && value < schema.minimum) fail();
      if (schema.maximum !== undefined && value > schema.maximum) fail();
      if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) fail();
      if (schema.exclusiveMaximum !== undefined && value >= schema.exclusiveMaximum) fail();
      break;
    case "array":
      if (!Array.isArray(value)) return fail();
      if (schema.minItems !== undefined && value.length < schema.minItems) fail();
      if (schema.maxItems !== undefined && value.length > schema.maxItems) fail();
      value.forEach((item, index) =>
        visit(schema.items ?? {}, item, root, `${path}[${index}]`, depth + 1),
      );
      break;
    case "object":
      if (!object(value)) return fail();
      for (const key of schema.required ?? []) {
        if (!Object.hasOwn(value, key)) throw new ContractValidationError(`${path}.${key}`);
      }
      for (const [key, item] of Object.entries(value)) {
        const child =
          schema.properties && Object.hasOwn(schema.properties, key)
            ? schema.properties[key]
            : undefined;
        if (child) visit(child, item, root, `${path}.${key}`, depth + 1);
        else if (schema.additionalProperties === false) fail();
        else if (object(schema.additionalProperties))
          visit(schema.additionalProperties, item, root, `${path}.*`, depth + 1);
      }
      for (const [first, last, order] of schema["x-ordered-pairs"] ?? []) {
        const a = value[first];
        const b = value[last];
        if (typeof a !== "number" || typeof b !== "number" || (order === "lt" ? a >= b : a > b))
          fail();
      }
      break;
  }
}

export function validateContract(schema: Schema, value: unknown): void {
  visit(schema, value, schema, "$", 0);
}
