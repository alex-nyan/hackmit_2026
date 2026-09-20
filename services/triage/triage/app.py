"""Bounded, authenticated ASGI boundary. Run with one worker and no request queue."""

import asyncio
import hashlib
import hmac
import json
import logging
import re
import time
import uuid
from contextlib import asynccontextmanager, suppress
from datetime import UTC, datetime

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from pydantic import ValidationError
from starlette.requests import ClientDisconnect

from triage.audio import AudioError, prepared_audio
from triage.config import Settings
from triage.images import ImageError, prepare_image
from triage.live_api import LiveAPI
from triage.pipeline import TriagePipeline
from triage.schemas import TranscriptionRequest, TranscriptionResult, TriageRequest
from triage.store import ResultStore, StoreError
from triage.transcription import TranscriptionError, TranscriptionService

logger = logging.getLogger("triage.audit")
KEY_PATTERN = re.compile(r"^[A-Za-z0-9_.:-]{1,128}$")


class RequestError(Exception):
    def __init__(self, status: int, code: str):
        self.status, self.code = status, code
        super().__init__(code)


class Admission:
    """No await between test and increment; event-loop-local immediate admission."""

    def __init__(self, limit: int):
        self.limit, self.active = limit, 0

    def acquire(self) -> bool:
        if self.active >= self.limit:
            return False
        self.active += 1
        return True

    def release(self) -> None:
        self.active -= 1


async def finish_before_cancel(task):
    """Do not release admission or close an image while its native worker runs.

    Cancellation of an asyncio.to_thread await does not stop the underlying
    inference thread. Shield the complete processing task, wait for it to finish,
    then propagate cancellation. Repeated shutdown cancellation is also handled.
    """
    cancelled = False
    while True:
        try:
            result = await asyncio.shield(task)
            break
        except asyncio.CancelledError:
            if task.cancelled():
                raise
            cancelled = True
            if task.done():
                break
    if cancelled:
        # Retrieve a failed task's exception to avoid an unhandled-task warning.
        if not task.cancelled():
            task.exception()
        raise asyncio.CancelledError
    return result


async def bounded_body(request: Request, limit: int) -> bytes:
    content_length = request.headers.get("content-length")
    if content_length is not None:
        if not content_length.isascii() or not content_length.isdecimal():
            raise RequestError(400, "invalid_content_length")
        if len(content_length) > 12 or int(content_length) > limit:
            raise RequestError(413, "request_too_large")
    body = bytearray()
    async for chunk in request.stream():
        if len(body) + len(chunk) > limit:
            raise RequestError(413, "request_too_large")
        body.extend(chunk)
    return bytes(body)


def create_app(settings: Settings | None = None, pipeline=None, transcription=None) -> FastAPI:
    settings = settings or Settings()
    pipeline = pipeline or TriagePipeline(settings)
    transcription = transcription or TranscriptionService(settings)
    admission = Admission(settings.max_concurrency)
    in_flight_keys: set[str] = set()
    store = None
    expected_token = ("Bearer " + settings.api_token.get_secret_value()).encode("ascii")
    live_api = LiveAPI(settings)

    def authenticate(request: Request) -> None:
        supplied = request.headers.get("authorization", "").encode("utf-8")
        if not hmac.compare_digest(supplied, expected_token):
            raise RequestError(401, "unauthorized")

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        nonlocal store
        logger.setLevel(logging.INFO)
        if not logger.handlers:
            handler = logging.StreamHandler()
            handler.setFormatter(logging.Formatter("%(message)s"))
            logger.addHandler(handler)
        try:
            store = ResultStore(
                settings.database_path, settings.retention_hours, settings.max_records
            )
            app.state.store = store
            async with live_api.lifespan():
                yield
        finally:
            try:
                await pipeline.close()
            finally:
                if store is not None:
                    store.close()

    app = FastAPI(
        title="GridLens human-reviewed hazard triage",
        version="1.0.0",
        lifespan=lifespan,
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )
    app.state.admission = admission
    app.state.live_api = live_api
    app.include_router(live_api.router)

    @app.get("/health/live")
    async def live():
        return {"status": "live"}

    @app.get("/health/ready")
    async def ready(request: Request):
        request_id = str(uuid.uuid4())
        try:
            authenticate(request)
            # Readiness cannot schedule additional native model work during triage.
            if not admission.acquire():
                raise RequestError(503, "service_busy")
            try:
                checks = await finish_before_cancel(asyncio.create_task(pipeline.ready()))
            finally:
                admission.release()
            healthy = store is not None and bool(checks) and all(checks.values())
            return JSONResponse(
                {"status": "ready" if healthy else "not_ready", "checks": checks},
                status_code=200 if healthy else 503,
                headers={"X-Request-ID": request_id, "Cache-Control": "no-store"},
            )
        except RequestError as error:
            return error_response(error, request_id)
        except Exception:
            return error_response(RequestError(503, "readiness_unavailable"), request_id)

    @app.post("/v1/triage")
    async def triage(request: Request):
        request_id = str(uuid.uuid4())
        started = time.monotonic()
        admitted, claimed, replay = False, False, False
        key, fingerprint, prepared = "", "", None
        status, code = 503, "triage_unavailable"
        try:
            authenticate(request)
            if request.headers.get("content-encoding", "identity").lower() != "identity":
                raise RequestError(415, "unsupported_content_encoding")
            media_type = request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
            if media_type != "application/json":
                raise RequestError(415, "json_required")
            key = request.headers.get("idempotency-key", "")
            if not KEY_PATTERN.fullmatch(key):
                raise RequestError(400, "invalid_idempotency_key")
            if key in in_flight_keys:
                raise RequestError(409, "idempotency_in_progress")
            if not admission.acquire():
                raise RequestError(429, "service_busy")
            admitted = True
            in_flight_keys.add(key)
            if store is None:
                raise RequestError(503, "result_store_unavailable")
            try:
                async with asyncio.timeout(settings.request_read_timeout_seconds):
                    body = await bounded_body(request, settings.max_request_bytes)
            except TimeoutError:
                raise RequestError(408, "request_read_timeout") from None
            try:
                payload = TriageRequest.model_validate_json(body)
            except (ValidationError, ValueError):
                raise RequestError(422, "invalid_request") from None
            canonical = json.dumps(
                payload.model_dump(mode="json"), sort_keys=True, separators=(",", ":")
            )
            fingerprint = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
            claim = store.claim(key, fingerprint)
            if claim.replay is not None:
                replay = True
                result = claim.replay
                request_id = result.request_id
            else:
                claimed = True
                age = (datetime.now(UTC) - payload.captured_at).total_seconds()
                if age > settings.max_frame_age_seconds:
                    raise RequestError(422, "stale_frame")
                if age < -30:
                    raise RequestError(422, "future_frame")
                preparation = asyncio.create_task(
                    asyncio.to_thread(prepare_image, payload, settings)
                )
                try:
                    prepared = await finish_before_cancel(preparation)
                except asyncio.CancelledError:
                    if not preparation.cancelled() and preparation.exception() is None:
                        preparation.result().image.close()
                    raise

                async def process_and_store():
                    result = await pipeline.process(payload, prepared, request_id)
                    store.complete(key, fingerprint, result)
                    return result

                result = await finish_before_cancel(asyncio.create_task(process_and_store()))
            status, code = 200, "triage_replayed" if replay else "triage_completed"
            return JSONResponse(
                result.model_dump(mode="json"),
                headers={
                    "X-Request-ID": request_id,
                    "Cache-Control": "no-store",
                    "Idempotency-Replayed": str(replay).lower(),
                },
            )
        except RequestError as error:
            status, code = error.status, error.code
            return error_response(error, request_id)
        except ImageError:
            status, code = 422, "invalid_image"
            return error_response(RequestError(status, code), request_id)
        except StoreError as error:
            code = error.code
            status = 409 if code in {"idempotency_conflict", "idempotency_in_progress"} else 503
            return error_response(RequestError(status, code), request_id)
        except ClientDisconnect:
            status, code = 400, "client_disconnected"
            return error_response(RequestError(status, code), request_id)
        except Exception:
            status, code = 503, "triage_unavailable"
            return error_response(RequestError(status, code), request_id)
        finally:
            if claimed and store is not None:
                with suppress(StoreError):
                    store.abandon(key, fingerprint)
            if prepared is not None:
                prepared.image.close()
            if admitted:
                in_flight_keys.discard(key)
                admission.release()
            logger.info(
                json.dumps(
                    {
                        "event": "triage_request",
                        "request_id": request_id,
                        "status": status,
                        "code": code,
                        "replayed": replay,
                        "duration_ms": round((time.monotonic() - started) * 1000, 2),
                    },
                    separators=(",", ":"),
                )
            )

    @app.post("/v1/transcribe")
    async def transcribe(request: Request):
        request_id = str(uuid.uuid4())
        started = time.monotonic()
        admitted = False
        status, code = 503, "transcription_unavailable"
        try:
            authenticate(request)
            if not settings.transcription_enabled:
                raise RequestError(503, "transcription_disabled")
            if request.headers.get("content-encoding", "identity").lower() != "identity":
                raise RequestError(415, "unsupported_content_encoding")
            media_type = request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
            if media_type != "application/json":
                raise RequestError(415, "json_required")
            # Transcription competes with vision for the same native model budget.
            if not admission.acquire():
                raise RequestError(429, "service_busy")
            admitted = True

            try:
                async with asyncio.timeout(settings.request_read_timeout_seconds):
                    body = await bounded_body(request, settings.max_request_bytes)
            except TimeoutError:
                raise RequestError(408, "request_read_timeout") from None

            try:
                payload = TranscriptionRequest.model_validate_json(body)
            except (ValidationError, ValueError):
                raise RequestError(422, "invalid_request") from None

            age = (datetime.now(UTC) - payload.captured_at).total_seconds()
            if age > settings.max_clip_age_seconds:
                raise RequestError(422, "stale_clip")
            if age < -30:
                raise RequestError(422, "future_clip")

            with prepared_audio(payload, settings) as audio:
                result, models, timings = await finish_before_cancel(
                    asyncio.create_task(transcription.process(audio, payload.language))
                )
                digest = audio.sha256

            processed_at = datetime.now(UTC)
            payload_out = TranscriptionResult(
                request_id=request_id,
                source_id=payload.source_id,
                incident_id=payload.incident_id,
                captured_at=payload.captured_at,
                processed_at=processed_at,
                audio_sha256=digest,
                text=result.text,
                speech_detected=bool(result.text),
                language=result.language,
                language_probability=result.language_probability,
                duration_seconds=result.duration_seconds,
                segments=result.segments,
                models=models,
                warnings=result.warnings,
                timings_ms=timings,
            )
            status, code = 200, "transcription_completed"
            return JSONResponse(
                payload_out.model_dump(mode="json"),
                headers={"X-Request-ID": request_id, "Cache-Control": "no-store"},
            )
        except RequestError as error:
            status, code = error.status, error.code
            return error_response(error, request_id)
        except AudioError as error:
            status, code = 422, error.code
            return error_response(RequestError(status, code), request_id)
        except TranscriptionError as error:
            status = 503 if error.code != "audio_too_long" else 422
            code = error.code
            return error_response(RequestError(status, code), request_id)
        except ClientDisconnect:
            status, code = 400, "client_disconnected"
            return error_response(RequestError(status, code), request_id)
        except Exception:
            status, code = 503, "transcription_unavailable"
            return error_response(RequestError(status, code), request_id)
        finally:
            if admitted:
                admission.release()
            logger.info(
                json.dumps(
                    {
                        "event": "transcription_request",
                        "request_id": request_id,
                        "status": status,
                        "code": code,
                        "duration_ms": round((time.monotonic() - started) * 1000, 2),
                    },
                    separators=(",", ":"),
                )
            )

    return app


def error_response(error: RequestError, request_id: str) -> JSONResponse:
    headers = {"X-Request-ID": request_id, "Cache-Control": "no-store"}
    if error.status == 401:
        headers["WWW-Authenticate"] = "Bearer"
    if error.status in {429, 503}:
        headers["Retry-After"] = "2"
    return JSONResponse(
        {"error": {"code": error.code, "request_id": request_id}},
        status_code=error.status,
        headers=headers,
    )
