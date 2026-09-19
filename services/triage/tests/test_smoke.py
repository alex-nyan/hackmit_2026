"""The diagnostic must reject degraded inference even when readiness succeeds."""

import pytest

from scripts import smoke_test
from triage.app import create_app
from triage.config import Settings
from triage.pipeline import TriagePipeline
from triage.providers import ProviderError, VisionInference
from triage.schemas import ModelProvenance, VisionAssessment


class Detector:
    def __init__(self, fail):
        self.fail = fail

    def ready(self):
        return True

    def detect(self, image):
        if self.fail:
            raise ProviderError("detector_failed")
        return []

    def provenance(self):
        return ModelProvenance(provider="ultralytics", model="fixture", revision="a" * 64)


class LocalVision:
    async def ready(self):
        return True

    async def assess(self, image, detections):
        return VisionInference(
            assessment=VisionAssessment(
                summary="Synthetic blank image",
                image_quality="unusable",
                hazards=[],
                limitations=["No scene visible"],
            ),
            provenance=ModelProvenance(provider="ollama", model="fixture", revision="b" * 64),
        )

    async def close(self):
        pass


@pytest.mark.parametrize(
    "detector_enabled,prediction_fails,expected_failure",
    [(True, True, True), (True, False, False), (False, True, False)],
)
def test_diagnostic_requires_prediction_from_each_enabled_model(
    tmp_path, monkeypatch, detector_enabled, prediction_fails, expected_failure
):
    monkeypatch.chdir(tmp_path)
    settings = Settings(api_token="test-token-" * 4, yolo_enabled=detector_enabled)
    monkeypatch.setattr(smoke_test, "Settings", lambda: settings)

    def application(config):
        return create_app(
            config,
            TriagePipeline(config, detector=Detector(prediction_fails), local=LocalVision()),
        )

    monkeypatch.setattr(smoke_test, "create_app", application)
    if expected_failure:
        with pytest.raises(SystemExit, match="Required model inference failed"):
            smoke_test.main()
        assert not (tmp_path / ".runtime" / "smoke-report.json").exists()
    else:
        smoke_test.main()
        assert (tmp_path / ".runtime" / "smoke-report.json").exists()
