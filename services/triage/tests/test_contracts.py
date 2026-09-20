"""Guard the generated wire boundary where compile-time types cannot protect clients."""

import pytest

from scripts.export_contracts import check_supported, ts_type
from triage.live_schemas import IncidentSnapshot, TelemetryRequest
from triage.schemas import TriageResult


def test_serialized_defaults_are_mandatory_in_output_contracts():
    schema = TriageResult.model_json_schema(mode="serialization")
    assert {
        "schema_version",
        "requires_human_review",
        "confidence_semantics",
        "policy_version",
    } <= set(schema["required"])
    assert "revision" in schema["$defs"]["ModelProvenance"]["required"]
    assert "schema_version" in IncidentSnapshot.model_json_schema(mode="serialization")["required"]


def test_input_defaults_remain_optional():
    schema = TelemetryRequest.model_json_schema(mode="validation")
    assert "schema_version" not in schema["required"]
    assert schema["$defs"]["HeartRateValue"]["required"] == ["bpm"]


def test_generator_refuses_to_silently_ignore_new_constraints():
    with pytest.raises(ValueError, match="Unsupported JSON Schema keywords"):
        check_supported({"type": "array", "items": {"type": "number", "multipleOf": 2}})
    with pytest.raises(ValueError, match="Unsupported JSON Schema format"):
        check_supported({"type": "string", "format": "email"})


def test_generated_unions_preserve_the_schema_discriminators():
    assert ts_type({"enum": ["unknown", "unavailable"]}) == '"unknown" | "unavailable"'
    assert (
        ts_type({"anyOf": [{"$ref": "#/$defs/Observation"}, {"type": "null"}]})
        == "Observation | null"
    )
