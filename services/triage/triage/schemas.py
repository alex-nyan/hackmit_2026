"""Versioned, bounded contracts. Model confidence is never a calibrated probability."""

from datetime import datetime
from typing import Annotated, Literal

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, model_validator

Score = Annotated[float, Field(ge=0, le=1, allow_inf_nan=False, strict=True)]
Text = Annotated[str, Field(min_length=1, max_length=1000)]
TranscriptText = Annotated[str, Field(max_length=20_000)]
Seconds = Annotated[float, Field(ge=0, le=86_400, allow_inf_nan=False)]


class Contract(BaseModel):
    model_config = ConfigDict(
        extra="forbid", str_strip_whitespace=True, json_schema_serialization_defaults_required=True
    )


class TriageRequest(Contract):
    image_base64: str = Field(min_length=1, max_length=11_200_000)
    media_type: Literal["image/jpeg", "image/png", "image/webp"]
    source_id: str = Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9_.:-]+$")
    captured_at: AwareDatetime
    incident_id: str | None = Field(default=None, max_length=128, pattern=r"^[A-Za-z0-9_.:-]+$")
    allow_cloud: bool = Field(default=False, strict=True)


class BoundingBox(Contract):
    model_config = ConfigDict(
        json_schema_extra={"x-ordered-pairs": [["x1", "x2", "lt"], ["y1", "y2", "lt"]]}
    )

    x1: Score
    y1: Score
    x2: Score
    y2: Score

    @model_validator(mode="after")
    def ordered(self):
        if self.x1 >= self.x2 or self.y1 >= self.y2:
            raise ValueError("bounding box must have positive area")
        return self


class Detection(Contract):
    label: str = Field(min_length=1, max_length=80)
    confidence: Score
    bbox: BoundingBox


class Hazard(Contract):
    category: Literal[
        "fire_smoke",
        "traffic_collision",
        "blocked_access",
        "structural_damage",
        "flooding",
        "electrical_hazard",
        "person_down",
        "visible_weapon",
        "other",
    ]
    severity: Literal["low", "moderate", "high", "critical"]
    confidence: Score
    visual_evidence: Text
    uncertainty: Text
    detection_indices: list[Annotated[int, Field(ge=0, strict=True)]] = Field(max_length=20)


class VisionAssessment(Contract):
    summary: Text
    image_quality: Literal["adequate", "limited", "unusable"]
    hazards: list[Hazard] = Field(max_length=20)
    limitations: list[Text] = Field(min_length=1, max_length=10)


class ModelProvenance(Contract):
    provider: Literal["ollama", "openai_compatible", "ultralytics", "faster_whisper"]
    model: str = Field(min_length=1, max_length=256)
    revision: str | None = Field(default=None, max_length=256)


class TriageResult(Contract):
    schema_version: Literal["1.0"] = "1.0"
    request_id: str
    source_id: str
    incident_id: str | None
    captured_at: datetime
    processed_at: datetime
    image_sha256: str
    status: Literal["needs_review", "insufficient_evidence"]
    review_priority: Literal["immediate", "urgent", "routine", "insufficient_evidence"]
    requires_human_review: Literal[True] = True
    confidence_semantics: Literal["uncalibrated_model_scores"] = "uncalibrated_model_scores"
    assessment: VisionAssessment | None
    detections: list[Detection]
    models: list[ModelProvenance]
    warnings: list[str]
    timings_ms: dict[str, float]
    policy_version: Literal["human-review-v1"] = "human-review-v1"
    prompt_version: Literal["visual-hazards-v1"] = "visual-hazards-v1"


class TranscriptionRequest(Contract):
    audio_base64: str = Field(min_length=1, max_length=11_200_000)
    media_type: Literal[
        "audio/mp4",
        "audio/aac",
        "audio/mpeg",
        "audio/wav",
        "audio/webm",
        "audio/ogg",
    ]
    source_id: str = Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9_.:-]+$")
    captured_at: AwareDatetime
    incident_id: str | None = Field(default=None, max_length=128, pattern=r"^[A-Za-z0-9_.:-]+$")
    # An ISO-639-1 hint. Omitted means the model decides, which it can get wrong.
    language: str | None = Field(default=None, min_length=2, max_length=8, pattern=r"^[a-z-]+$")


class TranscriptSegment(Contract):
    model_config = ConfigDict(
        json_schema_extra={"x-ordered-pairs": [["start_seconds", "end_seconds", "lte"]]}
    )

    start_seconds: Seconds
    end_seconds: Seconds
    text: Text
    """Whisper's own estimate that this span is not speech. Uncalibrated."""
    no_speech_probability: Score | None = None

    @model_validator(mode="after")
    def ordered(self):
        if self.end_seconds < self.start_seconds:
            raise ValueError("segment must not end before it starts")
        return self


class TranscriptionResult(Contract):
    """
    A transcript is a model hypothesis about what was said, not a record of it.
    Empty text means no speech was recognised, which is not the same as silence,
    and a confident-looking transcript can still be wrong. Both are stated in the
    payload so a caller cannot quietly treat this as evidence.
    """

    schema_version: Literal["1.0"] = "1.0"
    request_id: str
    source_id: str
    incident_id: str | None
    captured_at: datetime
    processed_at: datetime
    audio_sha256: str
    text: TranscriptText
    speech_detected: bool
    language: str | None
    language_probability: Score | None
    duration_seconds: Seconds
    segments: list[TranscriptSegment] = Field(max_length=500)
    models: list[ModelProvenance]
    warnings: list[str]
    timings_ms: dict[str, float]
    requires_human_review: Literal[True] = True
    confidence_semantics: Literal["uncalibrated_model_scores"] = "uncalibrated_model_scores"
    transcript_semantics: Literal["machine_hypothesis_not_verbatim_record"] = (
        "machine_hypothesis_not_verbatim_record"
    )
