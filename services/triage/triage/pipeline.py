"""Human-review policy is deterministic and independent of model confidence."""

import asyncio
import time
from datetime import UTC, datetime

from triage.config import Settings
from triage.images import PreparedImage
from triage.providers import OllamaProvider, OpenAICompatibleProvider, ProviderError, YoloDetector
from triage.schemas import TriageRequest, TriageResult, VisionAssessment


def review_priority(assessment: VisionAssessment | None) -> str:
    if assessment is None:
        return "insufficient_evidence"
    severities = {hazard.severity for hazard in assessment.hazards}
    if "critical" in severities:
        return "immediate"
    if "high" in severities:
        return "urgent"
    if assessment.image_quality != "adequate":
        return "insufficient_evidence"
    return "routine"


class TriagePipeline:
    def __init__(self, settings: Settings, *, detector=None, local=None, cloud=None):
        self.settings = settings
        self.detector = detector if detector is not None else YoloDetector(settings)
        self.local = local if local is not None else OllamaProvider(settings)
        self.cloud = cloud
        if self.cloud is None and settings.cloud_enabled:
            self.cloud = OpenAICompatibleProvider(settings)

    async def process(
        self, request: TriageRequest, prepared: PreparedImage, request_id: str
    ) -> TriageResult:
        started = time.monotonic()
        warnings = []
        models = []
        detections = []
        assessment = None
        detector_started = time.monotonic()
        if self.settings.yolo_enabled:
            try:
                detections = await asyncio.to_thread(self.detector.detect, prepared.image)
                models.append(await asyncio.to_thread(self.detector.provenance))
            except ProviderError as error:
                detections = []
                warnings.append(error.code)
            except Exception:
                detections = []
                warnings.append("detector_unavailable_or_failed")
        else:
            warnings.append("detector_disabled")
        detector_ms = (time.monotonic() - detector_started) * 1000
        vision_started = time.monotonic()

        cloud_allowed = bool(self.settings.cloud_enabled and request.allow_cloud and self.cloud)
        if self.settings.vision_provider == "openai_compatible":
            if not cloud_allowed:
                warnings.append("cloud_not_authorized_for_request")
            else:
                try:
                    inference = await self.cloud.assess(prepared.base64, detections)
                    assessment = inference.assessment
                    models.append(inference.provenance)
                except ProviderError as error:
                    assessment = None
                    warnings.append(error.code)
                except Exception:
                    assessment = None
                    warnings.append("vision_inference_failed")
        else:
            try:
                inference = await self.local.assess(prepared.base64, detections)
                assessment = inference.assessment
                models.append(inference.provenance)
            except Exception as error:
                assessment = None
                if isinstance(error, ProviderError):
                    warnings.append(error.code)
                warnings.append("local_vision_inference_failed")
                if self.settings.cloud_fallback_enabled and cloud_allowed:
                    try:
                        inference = await self.cloud.assess(prepared.base64, detections)
                        assessment = inference.assessment
                        models.append(inference.provenance)
                        warnings.append("cloud_fallback_used")
                    except Exception as fallback_error:
                        assessment = None
                        if isinstance(fallback_error, ProviderError):
                            warnings.append(fallback_error.code)
                        warnings.append("cloud_vision_inference_failed")
                elif self.settings.cloud_fallback_enabled:
                    warnings.append("cloud_not_authorized_for_request")

        # Defensive boundary even for an injected/alternative provider.
        if assessment is not None:
            try:
                assessment = VisionAssessment.model_validate(assessment)
                if any(
                    index >= len(detections)
                    for hazard in assessment.hazards
                    for index in hazard.detection_indices
                ):
                    raise ValueError("invalid detection reference")
            except Exception:
                assessment = None
                warnings.append("vision_output_invalid")
        if assessment is None:
            warnings.append("insufficient_visual_evidence_requires_human_review")
        elif assessment.image_quality != "adequate":
            warnings.append("image_quality_limits_assessment")
        priority = review_priority(assessment)
        return TriageResult(
            request_id=request_id,
            source_id=request.source_id,
            incident_id=request.incident_id,
            captured_at=request.captured_at,
            processed_at=datetime.now(UTC),
            image_sha256=prepared.sha256,
            status="insufficient_evidence"
            if priority == "insufficient_evidence"
            else "needs_review",
            review_priority=priority,
            assessment=assessment,
            detections=detections,
            models=models,
            warnings=warnings,
            timings_ms={
                "detector": round(detector_ms, 2),
                "vision": round((time.monotonic() - vision_started) * 1000, 2),
                "total": round((time.monotonic() - started) * 1000, 2),
            },
        )

    async def ready(self) -> dict[str, bool]:
        async def available(provider):
            try:
                return bool(await provider.ready())
            except Exception:
                return False

        selected = (
            self.cloud if self.settings.vision_provider == "openai_compatible" else self.local
        )
        vision_ready = await available(selected) if selected is not None else False
        try:
            detector_ready = (
                bool(await asyncio.to_thread(self.detector.ready))
                if self.settings.yolo_enabled
                else True
            )
        except Exception:
            detector_ready = False
        return {"vision": vision_ready, "detector": detector_ready}

    async def close(self) -> None:
        await self.local.close()
        if self.cloud is not None:
            await self.cloud.close()
