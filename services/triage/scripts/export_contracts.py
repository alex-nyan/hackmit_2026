"""Export JSON schemas and matching TypeScript contracts without loading models.

Output schemas describe model_dump(mode="json") with defaults included; requests
retain optional defaults. Run with --check in CI to detect contract drift.
"""

import argparse
import json
from pathlib import Path

from pydantic import TypeAdapter

from triage.live_schemas import (
    CommandReceipt,
    IncidentCommand,
    IncidentEvent,
    IncidentSnapshot,
    SessionInfo,
    TelemetryReceipt,
    TelemetryRequest,
)
from triage.schemas import (
    TranscriptionRequest,
    TranscriptionResult,
    TriageRequest,
    TriageResult,
)

# Fail generation on unsupported constraints instead of silently producing a
# validator that ignores a future server-side contract requirement.
SUPPORTED_KEYS = {
    "$schema",
    "$defs",
    "$ref",
    "title",
    "description",
    "default",
    "examples",
    "type",
    "properties",
    "required",
    "additionalProperties",
    "anyOf",
    "oneOf",
    "enum",
    "const",
    "items",
    "minItems",
    "maxItems",
    "minLength",
    "maxLength",
    "pattern",
    "format",
    "minimum",
    "maximum",
    "exclusiveMinimum",
    "exclusiveMaximum",
    "x-ordered-pairs",
    "discriminator",
}


def check_supported(schema):
    unsupported = set(schema) - SUPPORTED_KEYS
    if unsupported:
        raise ValueError(f"Unsupported JSON Schema keywords: {sorted(unsupported)}")
    if schema.get("format") not in (None, "date-time"):
        raise ValueError(f"Unsupported JSON Schema format: {schema['format']}")
    for key in ("$defs", "properties"):
        for child in schema.get(key, {}).values():
            check_supported(child)
    for key in ("anyOf", "oneOf"):
        for child in schema.get(key, []):
            check_supported(child)
    for key in ("items", "additionalProperties"):
        if isinstance(schema.get(key), dict):
            check_supported(schema[key])


def ts_type(schema):
    if "$ref" in schema:
        return schema["$ref"].rsplit("/", 1)[1]
    if "const" in schema:
        return json.dumps(schema["const"])
    if "enum" in schema:
        return " | ".join(json.dumps(value) for value in schema["enum"])
    for key in ("anyOf", "oneOf"):
        if key in schema:
            return " | ".join(ts_type(child) for child in schema[key])
    kind = schema.get("type")
    if kind == "object":
        if "properties" not in schema:
            extra = schema.get("additionalProperties", {})
            return f"Record<string, {ts_type(extra) if isinstance(extra, dict) else 'unknown'}>"
        required = set(schema.get("required", []))
        fields = [
            f"  {json.dumps(name)}{'' if name in required else '?'}: {ts_type(value)};"
            for name, value in schema["properties"].items()
        ]
        return "{\n" + "\n".join(fields) + "\n}"
    if kind == "array":
        return f"Array<{ts_type(schema.get('items', {}))}>"
    return {
        "string": "string",
        "number": "number",
        "integer": "number",
        "boolean": "boolean",
        "null": "null",
    }.get(kind, "unknown")


def write_or_check(path, content, check):
    if check:
        if not path.exists() or path.read_text() != content:
            raise SystemExit(f"Stale contract: {path}; run python -m scripts.export_contracts")
    else:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    service = Path(__file__).resolve().parents[1]
    contracts = [
        ("triage-request", TriageRequest, "validation"),
        ("triage-result", TriageResult, "serialization"),
        ("transcription-request", TranscriptionRequest, "validation"),
        ("transcription-result", TranscriptionResult, "serialization"),
    ]
    contracts.extend(
        [
            ("session-info", SessionInfo, "serialization"),
            ("telemetry-request", TelemetryRequest, "validation"),
            ("telemetry-receipt", TelemetryReceipt, "serialization"),
            ("incident-snapshot", IncidentSnapshot, "serialization"),
            ("incident-event", IncidentEvent, "serialization"),
            ("command-receipt", CommandReceipt, "serialization"),
            ("incident-command", TypeAdapter(IncidentCommand), "validation"),
        ]
    )
    schemas = {}
    definitions = {}
    for filename, model, mode in contracts:
        name = "IncidentCommand" if isinstance(model, TypeAdapter) else model.__name__
        content = (
            model.json_schema(mode=mode)
            if isinstance(model, TypeAdapter)
            else model.model_json_schema(mode=mode)
        )
        schema = {"$schema": "https://json-schema.org/draft/2020-12/schema", **content}
        check_supported(schema)
        schemas[name] = (filename, schema)
        type_schema = schema
        if mode == "validation" and schema.get("$defs"):
            # Separate request types retain optional defaults even when output
            # types of the same model require serialized provenance fields.
            encoded = json.dumps(schema)
            for definition_name in schema["$defs"]:
                encoded = encoded.replace(
                    f'#/$defs/{definition_name}"', f'#/$defs/{definition_name}Input"'
                )
            type_schema = json.loads(encoded)
            type_schema["$defs"] = {
                key + "Input": value for key, value in type_schema["$defs"].items()
            }
        for definition_name, definition in type_schema.get("$defs", {}).items():
            # Output models must include defaults, while input models may omit
            # them. Their definitions remain in the individual schema files.
            if definition_name in definitions and definitions[definition_name] != definition:
                raise ValueError(f"Conflicting schema definition: {definition_name}")
            definitions[definition_name] = definition
        definitions[name] = type_schema
        write_or_check(
            service / "contracts" / f"{filename}.schema.json",
            json.dumps(schema, indent=2, sort_keys=True) + "\n",
            args.check,
        )

    lines = [
        "// Generated by services/triage/scripts/export_contracts.py; do not edit.",
        'import { validateContract } from "./runtime";',
    ]
    for name, (filename, _) in schemas.items():
        lines.append(
            f'import {name}Schema from "../../services/triage/contracts/{filename}.schema.json";'
        )
    for name in sorted(definitions):
        lines.extend(["", f"export type {name} = {ts_type(definitions[name])};"])
    for name in schemas:
        lines.extend(
            [
                "",
                f"export function parse{name}(value: unknown): {name} {{",
                f"  validateContract({name}Schema, value);",
                f"  return value as {name};",
                "}",
            ]
        )
    write_or_check(
        service.parents[1] / "shared/contracts/generated.ts", "\n".join(lines) + "\n", args.check
    )


if __name__ == "__main__":
    main()
