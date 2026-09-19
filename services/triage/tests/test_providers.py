import asyncio
import copy
import hashlib
import json
import sys
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace
from unittest.mock import Mock

import httpx
import pytest
from PIL import Image

from triage.config import Settings
from triage.providers import OllamaProvider, OpenAICompatibleProvider, ProviderError, YoloDetector
from triage.schemas import BoundingBox, Detection

ASSESSMENT = {
    "summary": "A possible obstruction is visible.",
    "image_quality": "adequate",
    "hazards": [
        {
            "category": "blocked_access",
            "severity": "moderate",
            "confidence": 0.7,
            "visual_evidence": "A vehicle overlaps the marked entrance.",
            "uncertainty": "The entrance may not be in use.",
            "detection_indices": [0],
        }
    ],
    "limitations": ["A single frame cannot establish movement."],
}
DETECTIONS = [
    Detection(
        label="car",
        confidence=0.8,
        bbox=BoundingBox(x1=0.1, y1=0.2, x2=0.8, y2=0.9),
    )
]
DIGEST = "a" * 64


def settings(**kwargs):
    return Settings(api_token="test-token-" * 4, _env_file=None, **kwargs)


def cloud_settings(**kwargs):
    return settings(
        cloud_enabled=True,
        cloud_base_url="https://vision.example/v1",
        cloud_api_key="test-cloud-key",
        cloud_model="vision-pinned",
        **kwargs,
    )


def ollama_response(assessment=None, **kwargs):
    return {
        "model": "gemma4:26b",
        "done": True,
        "done_reason": "stop",
        "message": {"role": "assistant", "content": json.dumps(assessment or ASSESSMENT)},
        **kwargs,
    }


def cloud_response(assessment=None, **kwargs):
    return {
        "model": "vision-pinned",
        "choices": [
            {
                "finish_reason": "stop",
                "message": {"role": "assistant", "content": json.dumps(assessment or ASSESSMENT)},
            }
        ],
        **kwargs,
    }


def local_handler(chat=None, show=None, tags=None, calls=None):
    def handler(request):
        if calls is not None:
            calls.append(request)
        if request.url.path == "/api/show":
            return httpx.Response(
                200, json=show if show is not None else {"capabilities": ["vision"]}
            )
        if request.url.path == "/api/tags":
            return httpx.Response(
                200,
                json=tags
                if tags is not None
                else {
                    "models": [{"name": "gemma4:26b", "digest": DIGEST}],
                },
            )
        assert request.url.path == "/api/chat"
        return httpx.Response(200, json=chat if chat is not None else ollama_response())

    return handler


async def test_ollama_sends_image_schema_and_binds_verified_provenance():
    calls = []
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(local_handler(calls=calls))
    ) as client:
        provider = OllamaProvider(settings(), client)
        assert await provider.ready()
        assert len(calls) == 2
        inference = await provider.assess("JPEG_BASE64", DETECTIONS)
        assert inference.assessment.hazards[0].detection_indices == [0]
        assert inference.provenance.revision == DIGEST
        assert inference.provenance.provider == "ollama"
        assert inference.provenance.model == "gemma4:26b"
        assert [request.url.path for request in calls[2:]] == [
            "/api/show",
            "/api/tags",
            "/api/chat",
            "/api/tags",
        ]
        body = json.loads(calls[-2].content)
        assert body["stream"] is False and body["think"] is False
        assert body["options"]["temperature"] == 0
        assert body["format"]["additionalProperties"] is False
        assert body["messages"][1]["images"] == ["JPEG_BASE64"]
        assert "untrusted" in body["messages"][0]["content"]
        await provider.close()
        assert not client.is_closed  # Injected clients remain owned by the caller.


async def test_ollama_rejects_tag_change_during_assessment():
    revision = DIGEST

    def handler(request):
        nonlocal revision
        if request.url.path == "/api/chat":
            revision = "b" * 64
        return local_handler(tags={"models": [{"name": "gemma4:26b", "digest": revision}]})(request)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        with pytest.raises(ProviderError, match="^provider_model_changed$"):
            await OllamaProvider(settings(), client).assess("image", DETECTIONS)


async def test_overlapping_ollama_assessments_do_not_misattribute_revision():
    first_chat_started = asyncio.Event()
    finish_first_chat = asyncio.Event()
    revision = DIGEST

    async def handler(request):
        if request.url.path == "/api/chat":
            body = json.loads(request.content)
            if body["messages"][1]["images"] == ["first"]:
                first_chat_started.set()
                await finish_first_chat.wait()
        return local_handler(tags={"models": [{"name": "gemma4:26b", "digest": revision}]})(request)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        provider = OllamaProvider(settings(max_concurrency=2), client)
        first = asyncio.create_task(provider.assess("first", DETECTIONS))
        try:
            await asyncio.wait_for(first_chat_started.wait(), timeout=1)
            revision = "b" * 64
            second = await provider.assess("second", DETECTIONS)
            assert second.provenance.revision == revision
            finish_first_chat.set()
            with pytest.raises(ProviderError, match="^provider_model_changed$"):
                await first
            assert second.provenance.revision == "b" * 64
        finally:
            finish_first_chat.set()
            await asyncio.gather(first, return_exceptions=True)


@pytest.mark.parametrize(
    "info,expected",
    [
        ({"capabilities": ["completion"]}, "provider_model_not_vision"),
        (
            {"capabilities": ["vision"], "remote_host": "https://ollama.com"},
            "provider_remote_model",
        ),
        ({"capabilities": ["vision"], "remote_model": "remote"}, "provider_remote_model"),
    ],
)
async def test_ollama_does_not_send_image_to_unsupported_or_remote_model(info, expected):
    calls = []
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(local_handler(show=info, calls=calls))
    ) as client:
        provider = OllamaProvider(settings(), client)
        assert not await provider.ready()
        with pytest.raises(ProviderError, match=expected):
            await provider.assess("PRIVATE_IMAGE", DETECTIONS)
        assert all(request.url.path != "/api/chat" for request in calls)
        assert all(b"PRIVATE_IMAGE" not in request.content for request in calls)


@pytest.mark.parametrize(
    "response,expected",
    [
        (ollama_response(model="another-model"), "provider_model_mismatch"),
        (ollama_response(done=False), "provider_incomplete"),
        (ollama_response(done_reason="length"), "provider_incomplete"),
        (
            ollama_response(message={"role": "assistant", "refusal": "upstream secret"}),
            "provider_refused",
        ),
        (
            ollama_response(message={"role": "assistant", "content": "```json\n{}\n```"}),
            "provider_invalid_response",
        ),
    ],
)
async def test_ollama_rejects_untrustworthy_envelopes(response, expected):
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(local_handler(chat=response))
    ) as client:
        with pytest.raises(ProviderError, match=expected) as error:
            await OllamaProvider(settings(), client).assess("image", DETECTIONS)
        assert "secret" not in str(error.value)


@pytest.mark.parametrize(
    "field,value",
    [
        ("confidence", float("nan")),
        ("confidence", float("inf")),
        ("confidence", "0.9"),
        ("confidence", True),
        ("confidence", 1.1),
        ("detection_indices", [1]),
        ("detection_indices", [-1]),
        ("detection_indices", [0, 0]),
        ("detection_indices", [True]),
        ("category", "criminal_intent"),
        ("visual_evidence", ""),
    ],
)
async def test_assessment_rejects_invalid_scores_and_evidence_references(field, value):
    assessment = copy.deepcopy(ASSESSMENT)
    assessment["hazards"][0][field] = value
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(local_handler(chat=ollama_response(assessment)))
    ) as client:
        with pytest.raises(ProviderError, match="provider_invalid_response"):
            await OllamaProvider(settings(), client).assess("image", DETECTIONS)


async def test_vision_runs_without_detector_proposals():
    assessment = copy.deepcopy(ASSESSMENT)
    assessment["hazards"][0]["detection_indices"] = []
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(local_handler(chat=ollama_response(assessment)))
    ) as client:
        assert (await OllamaProvider(settings(), client).assess("image", [])).assessment.hazards


async def test_cloud_request_has_strict_schema_inline_image_and_authorization():
    calls = []

    def handler(request):
        calls.append(request)
        if request.method == "GET":
            assert request.url.path == "/v1/models/vision-pinned"
            return httpx.Response(200, json={"id": "vision-pinned"})
        return httpx.Response(200, json=cloud_response())

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        provider = OpenAICompatibleProvider(cloud_settings(), client)
        assert await provider.ready()
        inference = await provider.assess("JPEG_BASE64", DETECTIONS)
        assert inference.assessment.hazards
        request = calls[-1]
        assert request.url.path == "/v1/chat/completions"
        assert request.headers["authorization"] == "Bearer test-cloud-key"
        body = json.loads(request.content)
        assert body["response_format"]["json_schema"]["strict"] is True
        assert body["messages"][1]["content"][1]["image_url"]["url"] == (
            "data:image/jpeg;base64,JPEG_BASE64"
        )
        assert inference.provenance.model == "vision-pinned"
        assert inference.provenance.provider == "openai_compatible"


def test_cloud_provider_cannot_be_instantiated_when_disabled():
    with pytest.raises(ProviderError, match="cloud_disabled"):
        OpenAICompatibleProvider(settings())


@pytest.mark.parametrize(
    "response,expected",
    [
        (cloud_response(model="wrong-model"), "provider_model_mismatch"),
        (cloud_response(choices=[]), "provider_invalid_response"),
        (
            cloud_response(
                choices=[
                    {
                        "finish_reason": "length",
                        "message": {
                            "role": "assistant",
                            "content": json.dumps(ASSESSMENT),
                        },
                    }
                ]
            ),
            "provider_incomplete",
        ),
        (
            cloud_response(
                choices=[
                    {
                        "finish_reason": "stop",
                        "message": {
                            "role": "assistant",
                            "refusal": "private upstream diagnostic",
                        },
                    }
                ]
            ),
            "provider_refused",
        ),
        (
            cloud_response(
                choices=[
                    {
                        "finish_reason": "content_filter",
                        "message": {
                            "role": "assistant",
                            "content": None,
                        },
                    }
                ]
            ),
            "provider_refused",
        ),
    ],
)
async def test_cloud_rejects_refusal_truncation_and_model_mismatch(response, expected):
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda _: httpx.Response(200, json=response))
    ) as client:
        with pytest.raises(ProviderError, match=expected):
            await OpenAICompatibleProvider(cloud_settings(), client).assess("image", DETECTIONS)


@pytest.mark.parametrize(
    "status,code",
    [
        (302, "provider_redirect"),
        (401, "provider_authentication"),
        (403, "provider_authentication"),
        (429, "provider_rate_limited"),
        (404, "provider_model_unavailable"),
        (500, "provider_unavailable"),
    ],
)
async def test_http_errors_never_leak_bodies_or_follow_redirects(status, code):
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(
            status,
            text="sensitive upstream content",
            headers={
                "location": "https://other.example/stolen",
            },
        )

    async with httpx.AsyncClient(
        transport=httpx.MockTransport(handler), follow_redirects=True
    ) as client:
        with pytest.raises(ProviderError, match=code) as error:
            await OpenAICompatibleProvider(cloud_settings(), client).assess("image", DETECTIONS)
        assert len(calls) == 1
        assert "sensitive" not in str(error.value)


class Chunks(httpx.AsyncByteStream):
    async def __aiter__(self):
        for _ in range(3):
            yield b"x" * 512


@pytest.mark.parametrize("with_length", [True, False])
async def test_response_byte_limit_applies_to_declared_and_streamed_body(with_length):
    def handler(request):
        if with_length:
            return httpx.Response(200, content=b"x" * 2000)
        return httpx.Response(200, stream=Chunks())

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        with pytest.raises(ProviderError, match="provider_response_too_large"):
            await OpenAICompatibleProvider(cloud_settings(max_response_bytes=1024), client).assess(
                "image",
                DETECTIONS,
            )


@pytest.mark.parametrize(
    "content",
    [
        b'{"model":"one","model":"two"}',
        b"[]",
        b"not JSON",
        b"\xff",
        b'{"value":NaN}',
    ],
)
async def test_invalid_outer_json_is_sanitized(content):
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda _: httpx.Response(200, content=content))
    ) as client:
        with pytest.raises(ProviderError, match="provider_invalid_response"):
            await OpenAICompatibleProvider(cloud_settings(), client).assess("image", DETECTIONS)


async def test_transport_timeout_is_sanitized():
    def handler(request):
        raise httpx.ReadTimeout("private URL/key", request=request)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        with pytest.raises(ProviderError, match="provider_timeout"):
            await OpenAICompatibleProvider(cloud_settings(), client).assess("image", DETECTIONS)


async def test_total_deadline_cancels_slow_response():
    cancelled = asyncio.Event()

    async def handler(request):
        try:
            await asyncio.sleep(10)
        finally:
            cancelled.set()

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        provider = OpenAICompatibleProvider(cloud_settings(provider_timeout_seconds=1), client)
        with pytest.raises(ProviderError, match="provider_timeout"):
            await provider.assess("image", DETECTIONS)
        assert cancelled.is_set()


def test_missing_weights_do_not_import_or_download_ultralytics(tmp_path, monkeypatch):
    fake = SimpleNamespace(YOLO=Mock())
    monkeypatch.setitem(sys.modules, "ultralytics", fake)
    detector = YoloDetector(settings(yolo_weights=tmp_path / "yolo26n.pt"))
    assert not detector.ready()
    with pytest.raises(ProviderError, match="detector_unavailable"):
        detector.detect(Image.new("RGB", (20, 20)))
    fake.YOLO.assert_not_called()


def test_weight_hash_mismatch_prevents_deserialization(tmp_path, monkeypatch):
    weights = tmp_path / "yolo26n.pt"
    weights.write_bytes(b"trusted file fixture")
    fake = SimpleNamespace(YOLO=Mock())
    monkeypatch.setitem(sys.modules, "ultralytics", fake)
    detector = YoloDetector(settings(yolo_weights=weights, yolo_sha256="0" * 64))
    assert not detector.ready()
    with pytest.raises(ProviderError, match="detector_hash_mismatch"):
        detector.detect(Image.new("RGB", (20, 20)))
    fake.YOLO.assert_not_called()


def fake_model(coordinates=None):
    def tensor(value):
        return SimpleNamespace(tolist=lambda: value)

    result = SimpleNamespace(
        names={2: "car"},
        boxes=SimpleNamespace(
            xyxyn=tensor(coordinates or [[0.1, 0.2, 0.8, 0.9]]),
            conf=tensor([0.8]),
            cls=tensor([2.0]),
        ),
    )
    return SimpleNamespace(task="detect", predict=Mock(return_value=[result]))


def test_detector_normalized_coordinates_hash_provenance_and_serialized_load(tmp_path, monkeypatch):
    weights = tmp_path / "yolo26n.pt"
    weights.write_bytes(b"trusted file fixture")
    digest = hashlib.sha256(weights.read_bytes()).hexdigest()
    model = fake_model()
    loader = Mock(return_value=model)
    monkeypatch.setitem(sys.modules, "ultralytics", SimpleNamespace(YOLO=loader))
    detector = YoloDetector(settings(yolo_weights=weights, yolo_sha256=digest))
    with ThreadPoolExecutor(max_workers=4) as executor:
        results = list(
            executor.map(lambda _: detector.detect(Image.new("RGB", (20, 20))), range(8))
        )
    loader.assert_called_once_with(str(weights.resolve()), task="detect", verbose=False)
    assert all(result == DETECTIONS for result in results)
    assert detector.provenance().revision == digest
    assert model.predict.call_args.kwargs["save"] is False


@pytest.mark.parametrize(
    "coordinates",
    [
        [[0.9, 0.2, 0.1, 0.8]],
        [[0.1, 0.2, 1.1, 0.9]],
        [[float("nan"), 0.1, 0.8, 0.9]],
    ],
)
def test_detector_rejects_invalid_boxes(tmp_path, monkeypatch, coordinates):
    weights = tmp_path / "yolo26n.pt"
    weights.write_bytes(b"trusted file fixture")
    monkeypatch.setitem(
        sys.modules,
        "ultralytics",
        SimpleNamespace(
            YOLO=Mock(return_value=fake_model(coordinates)),
        ),
    )
    detector = YoloDetector(settings(yolo_weights=weights))
    with pytest.raises(ProviderError, match="detector_invalid_output"):
        detector.detect(Image.new("RGB", (20, 20)))
