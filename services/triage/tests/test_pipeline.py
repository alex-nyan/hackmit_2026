import asyncio
import threading
from datetime import UTC, datetime

import pytest
from PIL import Image

from triage.config import Settings
from triage.images import PreparedImage
from triage.pipeline import TriagePipeline, review_priority
from triage.providers import VisionInference
from triage.schemas import Hazard, ModelProvenance, TriageRequest, VisionAssessment


def assessment(severity=None, confidence=0.01, quality="adequate"):
    hazards = (
        []
        if severity is None
        else [
            Hazard(
                category="fire_smoke",
                severity=severity,
                confidence=confidence,
                visual_evidence="A visible plume",
                uncertainty="Source cannot be determined",
                detection_indices=[],
            )
        ]
    )
    return VisionAssessment(
        summary="Requires operator assessment",
        image_quality=quality,
        hazards=hazards,
        limitations=["A single image has limited context"],
    )


class Detector:
    def __init__(self, fail=False):
        self.fail, self.calls = fail, 0

    def detect(self, image):
        self.calls += 1
        if self.fail:
            raise RuntimeError("sensitive internal detail")
        return []

    def provenance(self):
        return ModelProvenance(provider="ultralytics", model="fixture")

    def ready(self):
        return not self.fail


class Provider:
    def __init__(self, value=None, fail=False, name="ollama"):
        self.value = value if value is not None else assessment()
        self.fail, self.name, self.calls = fail, name, 0
        self.closed = False

    async def assess(self, image, detections):
        self.calls += 1
        if self.fail:
            raise RuntimeError("sensitive internal detail")
        return VisionInference(
            assessment=self.value,
            provenance=ModelProvenance(provider=self.name, model="fixture"),
        )

    async def ready(self):
        return not self.fail

    async def close(self):
        self.closed = True


def settings(**kwargs):
    return Settings(api_token="x" * 32, **kwargs)


async def run(pipeline, *, allow_cloud=False):
    frame = TriageRequest(
        image_base64="fixture",
        media_type="image/png",
        source_id="camera",
        captured_at=datetime.now(UTC),
        allow_cloud=allow_cloud,
    )
    with Image.new("RGB", (2, 2)) as image:
        return await pipeline.process(frame, PreparedImage(image, "fixture", "a" * 64), "request")


@pytest.mark.parametrize(
    ("severity", "quality", "expected"),
    [
        ("critical", "adequate", "immediate"),
        ("critical", "unusable", "immediate"),
        ("high", "limited", "urgent"),
        ("high", "adequate", "urgent"),
        ("moderate", "adequate", "routine"),
        ("low", "limited", "insufficient_evidence"),
        (None, "adequate", "routine"),
        (None, "unusable", "insufficient_evidence"),
    ],
)
def test_priority_does_not_downrank_low_confidence(severity, quality, expected):
    assert review_priority(assessment(severity, confidence=0.01, quality=quality)) == expected
    assert review_priority(assessment(severity, confidence=0.99, quality=quality)) == expected
    assert review_priority(None) == "insufficient_evidence"


@pytest.mark.parametrize("disabled,failed", [(False, False), (True, False), (False, True)])
async def test_vision_runs_without_detector_matches(disabled, failed):
    local, detector = Provider(), Detector(fail=failed)
    pipeline = TriagePipeline(settings(yolo_enabled=not disabled), local=local, detector=detector)
    result = await run(pipeline)
    assert local.calls == 1
    assert result.detections == []
    assert result.requires_human_review is True
    assert result.status == "needs_review"
    if disabled:
        assert detector.calls == 0 and "detector_disabled" in result.warnings
    if failed:
        assert "detector_unavailable_or_failed" in result.warnings


async def test_local_failure_never_returns_safe_or_leaks_error():
    pipeline = TriagePipeline(settings(), detector=Detector(), local=Provider(fail=True))
    result = await run(pipeline, allow_cloud=True)
    assert result.status == result.review_priority == "insufficient_evidence"
    assert result.requires_human_review is True
    assert result.assessment is None
    assert "sensitive" not in result.model_dump_json()


@pytest.mark.parametrize("consent", [False, True])
@pytest.mark.parametrize("primary", ["ollama", "openai_compatible"])
async def test_cloud_requires_request_and_deployment_consent(consent, primary):
    cloud, local = Provider(name="openai_compatible"), Provider(fail=True)
    pipeline = TriagePipeline(
        settings(
            cloud_enabled=True,
            cloud_fallback_enabled=True,
            vision_provider=primary,
            cloud_base_url="https://example.invalid/v1",
            cloud_api_key="secret",
            cloud_model="fixture",
        ),
        detector=Detector(),
        local=local,
        cloud=cloud,
    )
    result = await run(pipeline, allow_cloud=consent)
    assert cloud.calls == int(consent)
    assert (result.assessment is not None) == consent
    if not consent:
        assert "cloud_not_authorized_for_request" in result.warnings


async def test_request_consent_cannot_enable_disabled_deployment_cloud():
    cloud = Provider(name="openai_compatible")
    pipeline = TriagePipeline(
        settings(), detector=Detector(), local=Provider(fail=True), cloud=cloud
    )
    await run(pipeline, allow_cloud=True)
    assert cloud.calls == 0


async def test_no_cloud_fallback_after_successful_local_result():
    cloud = Provider(name="openai_compatible")
    pipeline = TriagePipeline(
        settings(
            cloud_enabled=True,
            cloud_fallback_enabled=True,
            cloud_base_url="https://example.invalid/v1",
            cloud_api_key="secret",
            cloud_model="fixture",
        ),
        detector=Detector(),
        local=Provider(),
        cloud=cloud,
    )
    await run(pipeline, allow_cloud=True)
    assert cloud.calls == 0


async def test_invalid_detection_references_fail_closed():
    invalid = assessment("high")
    invalid.hazards[0].detection_indices = [0]
    pipeline = TriagePipeline(settings(), detector=Detector(), local=Provider(invalid))
    result = await run(pipeline)
    assert result.assessment is None
    assert result.review_priority == "insufficient_evidence"
    assert "vision_output_invalid" in result.warnings


async def test_readiness_and_resource_cleanup():
    local, cloud = Provider(), Provider(name="openai_compatible")
    pipeline = TriagePipeline(settings(), detector=Detector(fail=True), local=local, cloud=cloud)
    assert await pipeline.ready() == {"vision": True, "detector": False}
    await pipeline.close()
    assert local.closed and cloud.closed


async def test_detector_provenance_does_not_block_event_loop():
    entered = threading.Event()
    released = threading.Event()

    class BlockingMetadata(Detector):
        def provenance(self):
            entered.set()
            assert released.wait(2), "event loop was blocked by native metadata lock"
            return super().provenance()

    pipeline = TriagePipeline(settings(), detector=BlockingMetadata(), local=Provider())
    task = asyncio.create_task(run(pipeline))
    try:
        assert await asyncio.to_thread(entered.wait, 2)
        released.set()
        result = await task
        assert result.status == "needs_review"
    finally:
        released.set()
        await task
