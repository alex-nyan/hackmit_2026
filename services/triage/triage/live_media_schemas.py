"""V2 media admission and machine output contracts; admission never means inference."""

from typing import Annotated, Literal

from pydantic import AwareDatetime, Field

from triage.schemas import Contract, Detection, ModelProvenance, TranscriptionResult

MediaIdentifier = Annotated[str, Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9_.:-]+$")]
MediaCounter = Annotated[int, Field(ge=0, le=9_007_199_254_740_991, strict=True)]


class MediaEnvelope(Contract):
    schema_version: Literal["2.0"] = "2.0"
    incident_id: MediaIdentifier
    source_id: MediaIdentifier
    boot_id: MediaIdentifier
    sequence: MediaCounter
    captured_at: AwareDatetime
    data_base64: str = Field(min_length=1, max_length=1_400_000)


class FrameMediaRequest(MediaEnvelope):
    kind: Literal["frame"]
    media_type: Literal["image/jpeg", "image/png", "image/webp"]


class AudioMediaRequest(MediaEnvelope):
    kind: Literal["audio"]
    media_type: Literal[
        "audio/wav", "audio/mp4", "audio/aac", "audio/mpeg", "audio/webm", "audio/ogg"
    ]


MediaRequest = Annotated[FrameMediaRequest | AudioMediaRequest, Field(discriminator="kind")]


class MediaReceipt(Contract):
    schema_version: Literal["2.0"] = "2.0"
    media_id: MediaIdentifier
    incident_id: MediaIdentifier
    source_id: MediaIdentifier
    kind: Literal["frame", "audio"]
    status: Literal["accepted", "replaced", "duplicate"]
    processing_semantics: Literal["admitted_not_processed"] = "admitted_not_processed"


class MediaResult(Contract):
    media_id: MediaIdentifier
    incident_id: MediaIdentifier
    source_id: MediaIdentifier
    kind: Literal["frame", "audio"]
    boot_id: MediaIdentifier
    sequence: MediaCounter
    captured_at: AwareDatetime
    processed_at: AwareDatetime
    status: Literal["observed", "unavailable"]
    evidence_refs: list[MediaIdentifier] = Field(max_length=2)
    detections: list[Detection] = Field(max_length=300)
    transcript: TranscriptionResult | None
    models: list[ModelProvenance] = Field(max_length=3)
    warnings: list[str] = Field(max_length=20)
    timings_ms: dict[str, Annotated[float, Field(ge=0, allow_inf_nan=False)]]
    requires_human_review: Literal[True] = True
    confidence_semantics: Literal["uncalibrated_model_scores"] = "uncalibrated_model_scores"


class ContextSummary(Contract):
    context_id: MediaIdentifier
    incident_id: MediaIdentifier
    source_id: MediaIdentifier
    snapshot_revision: MediaCounter
    generated_at: AwareDatetime
    evidence_refs: list[MediaIdentifier] = Field(min_length=1, max_length=4)
    summary: str = Field(min_length=1, max_length=1000)
    limitations: list[Annotated[str, Field(min_length=1, max_length=1000)]] = Field(
        min_length=1, max_length=10
    )
    model: ModelProvenance
    requires_human_review: Literal[True] = True
    context_semantics: Literal["unverified_visual_context_no_action_authority"] = (
        "unverified_visual_context_no_action_authority"
    )
