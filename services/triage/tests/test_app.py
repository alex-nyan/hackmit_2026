import asyncio
import base64
import io
import json
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta

import httpx
import pytest
from PIL import Image

from triage.app import create_app
from triage.config import Settings
from triage.schemas import TriageResult

TOKEN = "t" * 32
HEADERS = {"Authorization": f"Bearer {TOKEN}", "Idempotency-Key": "test-key"}


def frame(**updates):
    buffer = io.BytesIO()
    with Image.new("RGB", (10, 10), "red") as image:
        image.save(buffer, "PNG")
    return {
        "image_base64": base64.b64encode(buffer.getvalue()).decode(),
        "media_type": "image/png",
        "source_id": "test-camera",
        "captured_at": datetime.now(UTC).isoformat(),
        **updates,
    }


class Pipeline:
    def __init__(self):
        self.calls = 0
        self.closed = False
        self.fail = False
        self.started = asyncio.Event()
        self.finish = asyncio.Event()
        self.finish.set()

    async def process(self, request, prepared, request_id):
        self.calls += 1
        self.started.set()
        await self.finish.wait()
        if self.fail:
            raise ValueError("PRIVATE_PROMPT secret-token private-image")
        return TriageResult(
            request_id=request_id,
            source_id=request.source_id,
            incident_id=request.incident_id,
            captured_at=request.captured_at,
            processed_at=datetime.now(UTC),
            image_sha256=prepared.sha256,
            status="insufficient_evidence",
            review_priority="insufficient_evidence",
            assessment=None,
            detections=[],
            models=[],
            warnings=["insufficient_visual_evidence_requires_human_review"],
            timings_ms={},
        )

    async def ready(self):
        return {"vision": True, "detector": True}

    async def close(self):
        self.closed = True


@asynccontextmanager
async def service(tmp_path, **options):
    pipeline = Pipeline()
    settings = Settings(api_token=TOKEN, database_path=tmp_path / "result.sqlite3", **options)
    app = create_app(settings, pipeline)
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            yield client, pipeline, app
    assert pipeline.closed


async def test_auth_health_and_private_docs(tmp_path):
    async with service(tmp_path) as (client, _, _):
        assert (await client.get("/health/live")).status_code == 200
        assert (await client.get("/health/ready")).status_code == 401
        assert (await client.get("/health/ready", headers=HEADERS)).status_code == 200
        assert (await client.get("/docs")).status_code == 404
        assert (await client.get("/openapi.json")).status_code == 404
        result = await client.post("/v1/triage", json=frame())
        assert result.status_code == 401
        assert result.headers["www-authenticate"] == "Bearer"


async def test_auth_precedes_body_consumption(tmp_path):
    async def forbidden_body():
        raise AssertionError("body must not be consumed")
        yield b""

    async with service(tmp_path) as (client, _, _):
        response = await client.post("/v1/triage", content=forbidden_body())
        assert response.status_code == 401


async def test_idempotency_replay_conflict_and_no_image_persistence(tmp_path, caplog):
    async with service(tmp_path) as (client, pipeline, _):
        payload = frame()
        with caplog.at_level("INFO", logger="triage.audit"):
            first = await client.post("/v1/triage", json=payload, headers=HEADERS)
            repeat = await client.post("/v1/triage", json=payload, headers=HEADERS)
        assert first.status_code == repeat.status_code == 200
        assert first.json() == repeat.json()
        assert repeat.headers["idempotency-replayed"] == "true"
        assert pipeline.calls == 1
        for changed in [
            frame(source_id="different"),
            {**payload, "allow_cloud": True},
            {**payload, "captured_at": datetime.now(UTC).isoformat()},
        ]:
            conflict = await client.post("/v1/triage", json=changed, headers=HEADERS)
            assert conflict.status_code == 409
        assert payload["image_base64"] not in caplog.text
        assert TOKEN not in caplog.text
        assert "test-key" not in caplog.text
        assert payload["image_base64"].encode() not in (tmp_path / "result.sqlite3").read_bytes()


async def test_replay_still_works_after_frame_becomes_stale(tmp_path, monkeypatch):
    async with service(tmp_path) as (client, pipeline, _):
        payload = frame()
        first = await client.post("/v1/triage", json=payload, headers=HEADERS)

        class Later(datetime):
            @classmethod
            def now(cls, tz=None):
                return datetime.now(tz) + timedelta(hours=1)

        monkeypatch.setattr("triage.app.datetime", Later)
        repeat = await client.post("/v1/triage", json=payload, headers=HEADERS)
        assert repeat.status_code == 200
        assert repeat.json() == first.json()
        assert pipeline.calls == 1


@pytest.mark.parametrize("age,code", [(301, "stale_frame"), (-60, "future_frame")])
async def test_rejects_stale_or_future_frames_without_inference(tmp_path, age, code):
    async with service(tmp_path) as (client, pipeline, _):
        response = await client.post(
            "/v1/triage",
            json=frame(captured_at=(datetime.now(UTC) - timedelta(seconds=age)).isoformat()),
            headers=HEADERS,
        )
        assert response.status_code == 422
        assert response.json()["error"]["code"] == code
        assert pipeline.calls == 0
        retry = await client.post("/v1/triage", json=frame(), headers=HEADERS)
        assert retry.status_code == 200


@pytest.mark.parametrize("chunked", [False, True])
async def test_request_size_checked_before_validation(tmp_path, chunked):
    async def chunks():
        yield b"a" * 600
        yield b"b" * 600

    async with service(tmp_path, max_request_bytes=1024) as (client, pipeline, _):
        response = await client.post(
            "/v1/triage",
            content=chunks() if chunked else b"a" * 1200,
            headers={**HEADERS, "Content-Type": "application/json"},
        )
        assert response.status_code == 413
        assert pipeline.calls == 0


@pytest.mark.parametrize(
    "updates,status,code",
    [
        ({"Content-Type": "text/plain"}, 415, "json_required"),
        ({"Content-Encoding": "gzip"}, 415, "unsupported_content_encoding"),
        ({"Idempotency-Key": "bad key"}, 400, "invalid_idempotency_key"),
        ({"Idempotency-Key": ""}, 400, "invalid_idempotency_key"),
    ],
)
async def test_rejects_invalid_protocol_headers(tmp_path, updates, status, code):
    async with service(tmp_path) as (client, _, _):
        response = await client.post("/v1/triage", json=frame(), headers={**HEADERS, **updates})
        assert response.status_code == status
        assert response.json()["error"]["code"] == code


async def test_validation_and_unexpected_failures_never_echo_payload(tmp_path, caplog):
    async with service(tmp_path) as (client, pipeline, _):
        response = await client.post(
            "/v1/triage", json={"secret": "PRIVATE_PROMPT"}, headers=HEADERS
        )
        assert response.status_code == 422 and "PRIVATE_PROMPT" not in response.text
        pipeline.fail = True
        with caplog.at_level("INFO", logger="triage.audit"):
            response = await client.post("/v1/triage", json=frame(), headers=HEADERS)
        assert response.status_code == 503
        assert "PRIVATE_PROMPT" not in response.text + caplog.text


async def test_pressure_rejected_before_reading_body_and_same_key_reports_busy(tmp_path):
    async def forbidden_body():
        raise AssertionError("busy service must reject before reading body")
        yield b""

    async with service(tmp_path) as (client, pipeline, _):
        pipeline.finish.clear()
        running = asyncio.create_task(client.post("/v1/triage", json=frame(), headers=HEADERS))
        await pipeline.started.wait()
        try:
            duplicate = await client.post("/v1/triage", json=frame(), headers=HEADERS)
            assert duplicate.status_code == 409
            pressure = await client.post(
                "/v1/triage",
                content=forbidden_body(),
                headers={
                    **HEADERS,
                    "Idempotency-Key": "another",
                    "Content-Type": "application/json",
                },
            )
            assert pressure.status_code == 429
            assert pressure.headers["retry-after"] == "2"
        finally:
            pipeline.finish.set()
        assert (await running).status_code == 200


async def test_cancellation_holds_admission_until_work_is_durable(tmp_path):
    async with service(tmp_path) as (client, pipeline, app):
        pipeline.finish.clear()
        payload = frame()
        running = asyncio.create_task(client.post("/v1/triage", json=payload, headers=HEADERS))
        await pipeline.started.wait()
        running.cancel()
        await asyncio.sleep(0)
        assert app.state.admission.active == 1
        pressure = await client.post(
            "/v1/triage",
            json=frame(),
            headers={**HEADERS, "Idempotency-Key": "another"},
        )
        assert pressure.status_code == 429
        pipeline.finish.set()
        with pytest.raises(asyncio.CancelledError):
            await running
        assert app.state.admission.active == 0
        replay = await client.post("/v1/triage", json=payload, headers=HEADERS)
        assert replay.status_code == 200
        assert replay.headers["idempotency-replayed"] == "true"
        assert pipeline.calls == 1


async def test_completed_result_survives_service_restart(tmp_path):
    payload = frame()
    async with service(tmp_path) as (client, _, _):
        first = await client.post("/v1/triage", json=payload, headers=HEADERS)
    async with service(tmp_path) as (client, pipeline, _):
        second = await client.post("/v1/triage", json=payload, headers=HEADERS)
        assert second.json() == first.json()
        assert pipeline.calls == 0


async def test_invalid_image_has_safe_response(tmp_path):
    async with service(tmp_path) as (client, pipeline, _):
        response = await client.post(
            "/v1/triage", json=frame(image_base64="bad%%%"), headers=HEADERS
        )
        assert response.status_code == 422
        assert response.json()["error"]["code"] == "invalid_image"
        assert pipeline.calls == 0


async def test_canonical_json_reordering_replays(tmp_path):
    payload = frame()
    async with service(tmp_path) as (client, pipeline, _):
        first = await client.post("/v1/triage", json=payload, headers=HEADERS)
        second = await client.post(
            "/v1/triage",
            content=json.dumps(dict(reversed(list(payload.items())))),
            headers={**HEADERS, "Content-Type": "application/json"},
        )
        assert second.json() == first.json()
        assert pipeline.calls == 1


async def test_slow_body_expires_and_releases_admission(tmp_path):
    async def slow_body():
        yield b"{"
        await asyncio.sleep(2)
        yield b"}"

    async with service(tmp_path, request_read_timeout_seconds=1) as (client, pipeline, app):
        response = await client.post(
            "/v1/triage",
            content=slow_body(),
            headers={**HEADERS, "Content-Type": "application/json"},
        )
        assert response.status_code == 408
        assert response.json()["error"]["code"] == "request_read_timeout"
        assert pipeline.calls == 0
        assert app.state.admission.active == 0
        assert (await client.post("/v1/triage", json=frame(), headers=HEADERS)).status_code == 200


@pytest.mark.parametrize("value", ["true", "false", 1, 0])
async def test_cloud_consent_requires_a_json_boolean(tmp_path, value):
    async with service(tmp_path) as (client, pipeline, _):
        response = await client.post("/v1/triage", json=frame(allow_cloud=value), headers=HEADERS)
        assert response.status_code == 422
        assert pipeline.calls == 0
