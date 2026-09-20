"""V2 incident contracts. Source enrollment owns identity; models cannot issue commands."""

from typing import Annotated, Literal

from pydantic import AwareDatetime, ConfigDict, Field, SecretStr, model_validator

from triage.live_media_schemas import ContextSummary, MediaResult
from triage.schemas import Contract

Identifier = Annotated[str, Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9_.:-]+$")]
Counter = Annotated[int, Field(ge=0, le=9_007_199_254_740_991, strict=True)]
Finite = Annotated[float, Field(allow_inf_nan=False, strict=True)]
Role = Literal["source", "officer", "dispatch", "hospital"]


class LivePrincipal(Contract):
    principal_id: Identifier
    token: SecretStr = Field(min_length=32)
    role: Role
    incident_ids: list[Identifier] = Field(min_length=1, max_length=100)
    source_ids: list[Identifier] = Field(default_factory=list, max_length=100)

    @model_validator(mode="after")
    def valid_token(self):
        token = self.token.get_secret_value()
        if not token.isascii() or any(character.isspace() for character in token):
            raise ValueError("principal token must be ASCII without whitespace")
        if self.role == "source" and not self.source_ids:
            raise ValueError("source principal needs explicit source scope")
        return self


class SourceEnrollment(Contract):
    source_id: Identifier
    incident_id: Identifier
    kind: Literal["watch", "camera", "microphone", "gps", "device"]
    display_name: str = Field(min_length=1, max_length=100)
    wearer_id: Identifier | None = None
    wearer_role: Literal["responder", "patient"] | None = None

    @model_validator(mode="after")
    def valid_wearer(self):
        if (self.wearer_id is None) != (self.wearer_role is None):
            raise ValueError("wearer identity and role must be supplied together")
        if self.kind == "watch" and self.wearer_id is None:
            raise ValueError("Watch sources require an explicit wearer enrollment")
        return self


class SessionInfo(Contract):
    principal_id: Identifier
    role: Role
    incident_ids: list[Identifier]
    source_ids: list[Identifier]


class HeartRateValue(Contract):
    bpm: Annotated[float, Field(ge=1, le=400, allow_inf_nan=False, strict=True)]
    unit: Literal["bpm"] = "bpm"
    measurement_origin: Literal["watch_healthkit"] = "watch_healthkit"
    signal_quality: Literal["unknown"] = "unknown"
    measured_until: AwareDatetime | None = None
    session_mode: Literal["user_started_walking_workout"] | None = None
    sample_origin: Literal["healthkit_live_workout_statistics"] | None = None


class LocationValue(Contract):
    latitude: Annotated[float, Field(ge=-90, le=90, allow_inf_nan=False, strict=True)]
    longitude: Annotated[float, Field(ge=-180, le=180, allow_inf_nan=False, strict=True)]
    horizontal_accuracy_m: Annotated[
        float, Field(ge=0, le=100_000, allow_inf_nan=False, strict=True)
    ]
    speed_mps: Annotated[float, Field(ge=0, le=1000, allow_inf_nan=False, strict=True)] | None = (
        None
    )
    course_degrees: (
        Annotated[float, Field(ge=0, lt=360, allow_inf_nan=False, strict=True)] | None
    ) = None


class SourceHealthValue(Contract):
    availability: Literal["available", "interrupted", "unavailable"]
    reason: str | None = Field(default=None, max_length=200)
    battery_fraction: (
        Annotated[float, Field(ge=0, le=1, allow_inf_nan=False, strict=True)] | None
    ) = None


class SampleBase(Contract):
    sample_id: Identifier
    boot_id: Identifier
    sequence: Counter
    measured_at: AwareDatetime


class HeartRateSample(SampleBase):
    kind: Literal["heart_rate"]
    value: HeartRateValue


class LocationSample(SampleBase):
    kind: Literal["location"]
    value: LocationValue


class SourceHealthSample(SampleBase):
    kind: Literal["source_health"]
    value: SourceHealthValue


TelemetrySample = Annotated[
    HeartRateSample | LocationSample | SourceHealthSample, Field(discriminator="kind")
]


class TelemetryRequest(Contract):
    schema_version: Literal["2.0"] = "2.0"
    incident_id: Identifier
    source_id: Identifier
    samples: list[TelemetrySample] = Field(min_length=1, max_length=64)


class SampleReceipt(Contract):
    sample_id: Identifier
    status: Literal["accepted", "historical", "duplicate"]
    observation_id: Identifier
    warnings: list[str]


class TelemetryReceipt(Contract):
    schema_version: Literal["2.0"] = "2.0"
    incident_id: Identifier
    revision: Counter
    results: list[SampleReceipt]


class Observation(Contract):
    model_config = ConfigDict(
        json_schema_extra={
            "x-kind-value-models": {
                "heart_rate": "HeartRateValue",
                "location": "LocationValue",
                "source_health": "SourceHealthValue",
                "visual": "MediaResult",
                "transcript": "MediaResult",
                "context": "ContextSummary",
            },
            "x-kind-value-kinds": {"visual": "frame", "transcript": "audio"},
            "x-subject-kind": "heart_rate",
        }
    )
    observation_id: Identifier
    source_id: Identifier
    subject_id: Identifier | None
    kind: Literal["heart_rate", "location", "source_health", "visual", "transcript", "context"]
    measured_at: AwareDatetime
    received_at: AwareDatetime
    boot_id: Identifier
    sequence: Counter
    value: HeartRateValue | LocationValue | SourceHealthValue | MediaResult | ContextSummary
    provenance: Literal["device_reported", "machine_observed", "unverified_model_context"] = (
        "device_reported"
    )
    freshness: Literal["fresh", "stale", "historical"]
    age_seconds: Finite
    warnings: list[str]

    @model_validator(mode="after")
    def consistent_value(self):
        expected = {
            "heart_rate": HeartRateValue,
            "location": LocationValue,
            "source_health": SourceHealthValue,
            "visual": MediaResult,
            "transcript": MediaResult,
            "context": ContextSummary,
        }
        if not isinstance(self.value, expected[self.kind]):
            raise ValueError("observation kind must match its typed value")
        if self.kind != "heart_rate" and self.subject_id is not None:
            raise ValueError("only enrolled physiology carries a subject association")
        if isinstance(self.value, MediaResult) and self.value.kind != (
            "frame" if self.kind == "visual" else "audio"
        ):
            raise ValueError("media observation kind mismatch")
        return self


class SourceState(SourceEnrollment):
    availability: Literal["unknown", "available", "interrupted", "unavailable", "stale"]
    last_received_at: AwareDatetime | None
    last_measured_at: AwareDatetime | None
    age_seconds: Finite | None
    sequence_gaps: Counter
    boot_id: Identifier | None
    reason: str | None


class Attribution(Contract):
    principal_id: Identifier
    role: Role
    at: AwareDatetime
    note: str | None = Field(default=None, max_length=500)


class AlertEvent(Contract):
    alert_id: Identifier
    kind: Literal["assistance_request", "possible_visible_weapon", "visual_review"]
    claim: str = Field(min_length=1, max_length=1000)
    source_id: Identifier | None
    subject_id: Identifier | None
    observed_at: AwareDatetime
    created_at: AwareDatetime
    evidence_refs: list[Identifier] = Field(default_factory=list, max_length=8)
    priority: Literal["urgent_review", "review"]
    evidence_status: Literal["human_reported", "machine_observed", "human_rejected"]
    attention: Literal["unacknowledged", "acknowledged"]
    disposition: Literal["open", "human_resolved"]
    freshness: Literal["fresh", "stale"]
    requires_human_review: Literal[True] = True
    created_by: Attribution | None
    acknowledged_by: Attribution | None = None
    rejected_by: Attribution | None = None
    resolved_by: Attribution | None = None


class SceneReport(Contract):
    report_id: Identifier
    status: Literal["reported_clear", "restricted", "unknown"]
    scope: str = Field(min_length=1, max_length=300)
    note: str = Field(min_length=1, max_length=500)
    reported_by: Attribution
    expires_at: AwareDatetime
    revoked_by: Attribution | None = None
    effective: bool
    reassessment_required: bool = False


class IncidentSnapshot(Contract):
    schema_version: Literal["2.0"] = "2.0"
    incident_id: Identifier
    revision: Counter
    generated_at: AwareDatetime
    sources: list[SourceState]
    observations: list[Observation]
    alerts: list[AlertEvent]
    scene_reports: list[SceneReport]


class IncidentEvent(Contract):
    """An authorized invalidation event; clients fetch the role-projected snapshot."""

    schema_version: Literal["2.0"] = "2.0"
    event_id: Identifier
    incident_id: Identifier
    revision: Counter
    kind: Literal[
        "telemetry",
        "assistance",
        "alert_acknowledged",
        "alert_rejected",
        "alert_resolved",
        "scene_reported",
        "scene_report_revoked",
        "visual_observed",
        "transcript_observed",
        "context_updated",
        "source_reset",
    ]
    recorded_at: AwareDatetime


class AssistanceCommand(Contract):
    kind: Literal["assistance"]
    note: str = Field(min_length=1, max_length=500)
    source_id: Identifier | None = None


class AlertCommand(Contract):
    kind: Literal["acknowledge", "reject", "resolve"]
    expected_revision: Counter
    alert_id: Identifier
    note: str | None = Field(default=None, max_length=500)

    @model_validator(mode="after")
    def explanation(self):
        if self.kind in {"reject", "resolve"} and not self.note:
            raise ValueError("rejection and resolution need an explanation")
        return self


class SceneReportCommand(Contract):
    kind: Literal["scene_report"]
    expected_revision: Counter
    status: Literal["reported_clear", "restricted", "unknown"]
    scope: str = Field(min_length=1, max_length=300)
    note: str = Field(min_length=1, max_length=500)
    valid_for_seconds: Annotated[int, Field(ge=1, le=900, strict=True)]


class RevokeSceneReportCommand(Contract):
    kind: Literal["revoke_scene_report"]
    expected_revision: Counter
    report_id: Identifier
    note: str = Field(min_length=1, max_length=500)


IncidentCommand = Annotated[
    AssistanceCommand | AlertCommand | SceneReportCommand | RevokeSceneReportCommand,
    Field(discriminator="kind"),
]


class CommandReceipt(Contract):
    schema_version: Literal["2.0"] = "2.0"
    incident_id: Identifier
    command_id: Identifier
    revision: Counter
    alert_id: Identifier | None = None
    report_id: Identifier | None = None
