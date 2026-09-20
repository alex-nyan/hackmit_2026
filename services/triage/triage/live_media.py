"""Bounded live media workers. No model runs in the event loop or controls commands.

YOLO and Whisper live in independent, persistent spawn processes. A deadline kills
and reaps the native process before the next item can execute; cancelling an await
alone never releases capacity while native inference is still running.
"""

import asyncio
import base64
import binascii
import hashlib
import multiprocessing
import time
import uuid
from collections import OrderedDict, deque
from contextlib import suppress
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from pydantic import SecretStr

from triage.audio import AudioError, PreparedAudio, prepared_audio
from triage.config import Settings
from triage.images import ImageError, prepare_image
from triage.live_media_schemas import (
    ContextSummary,
    FrameMediaRequest,
    MediaReceipt,
    MediaRequest,
    MediaResult,
)
from triage.live_schemas import LivePrincipal
from triage.live_store import LiveError, require_incident, source_visible
from triage.providers import (
    OllamaProvider,
    OpenAICompatibleProvider,
    ProviderError,
    VisionProvider,
    YoloDetector,
)
from triage.schemas import (
    Detection,
    ModelProvenance,
    TranscriptionRequest,
    TranscriptionResult,
    TriageRequest,
)
from triage.transcription import FasterWhisperTranscriber, TranscriptionError


def _context_provider(settings: Settings) -> VisionProvider:
    """Live scene context follows the deployment's selected vision provider.

    A live session has no per-frame consent to carry, so the deployment's own
    TRIAGE_VISION_PROVIDER is the whole decision: choosing the cloud provider
    here means every enrolled camera's frames leave the host.
    """
    if settings.vision_provider == "openai_compatible":
        return OpenAICompatibleProvider(settings)
    return OllamaProvider(settings)


class WorkerFailure(Exception):
    """Fixed status codes only; never carry native errors or media into logs."""

    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


def native_worker(connection, settings: Settings, kind: str):
    """Spawn target; model initialization and all native decoding stay in this process."""
    detector = YoloDetector(settings) if kind == "frame" else None
    transcriber = FasterWhisperTranscriber(settings) if kind == "audio" else None
    try:
        while True:
            job = connection.recv()
            started = time.monotonic()
            try:
                if kind == "frame":
                    request = TriageRequest.model_validate(job)
                    prepared = prepare_image(request, settings)
                    try:
                        detections = detector.detect(prepared.image)
                        result = {
                            "detections": [item.model_dump(mode="json") for item in detections],
                            "models": [detector.provenance().model_dump(mode="json")],
                            "image_base64": prepared.base64,
                            "sha256": prepared.sha256,
                        }
                    finally:
                        prepared.image.close()
                else:
                    # Live sessions never download artifacts. Provision a local CTranslate2
                    # model directory before enabling this path.
                    if not Path(settings.whisper_model).is_dir():
                        raise TranscriptionError("transcriber_unavailable")
                    transcription = transcriber.transcribe(PreparedAudio(**job), None)
                    result = {
                        "text": transcription.text,
                        "language": transcription.language,
                        "language_probability": transcription.language_probability,
                        "duration_seconds": transcription.duration_seconds,
                        "segments": [
                            segment.model_dump(mode="json") for segment in transcription.segments
                        ],
                        "warnings": transcription.warnings,
                        "models": [transcriber.provenance().model_dump(mode="json")],
                    }
                result["elapsed_ms"] = (time.monotonic() - started) * 1000
                connection.send({"ok": result})
            except (ImageError, AudioError, ProviderError, TranscriptionError) as error:
                connection.send({"error": error.code})
            except Exception:
                connection.send({"error": "native_inference_failed"})
    except (EOFError, BrokenPipeError, OSError):
        pass
    finally:
        connection.close()


class NativeWorker:
    def __init__(self, settings: Settings, kind: str, timeout: float, *, target=native_worker):
        # Authentication and optional cloud credentials are unnecessary inside a model worker.
        self.settings = settings.model_copy(
            update={
                "api_token": SecretStr("local-native-worker-placeholder-token"),
                "live_principals": [],
                "cloud_api_key": None,
                "cloud_enabled": False,
                "cloud_fallback_enabled": False,
                "live_enabled": False,
            }
        )
        if kind == "audio":
            self.settings = self.settings.model_copy(
                update={
                    "max_audio_seconds": min(
                        settings.max_audio_seconds, settings.live_media_audio_max_age_seconds
                    ),
                }
            )
        self.kind, self.timeout, self.target = kind, timeout, target
        self.process = None
        self.connection = None
        self.lock = asyncio.Lock()
        self.faulted = False
        self.pending_exchange: asyncio.Task | None = None

    def _start(self):
        context = multiprocessing.get_context("spawn")
        parent, child = context.Pipe()
        process = context.Process(
            target=self.target, args=(child, self.settings, self.kind), daemon=True
        )
        process.start()
        child.close()
        self.process, self.connection = process, parent

    async def _stop(self):
        process, connection = self.process, self.connection
        try:
            if process is not None:
                if process.is_alive():
                    with suppress(ProcessLookupError):
                        process.kill()
                await asyncio.to_thread(process.join, 2)
                if process.is_alive():
                    raise WorkerFailure("native_worker_not_reaped")
                process.close()
            if connection is not None:
                connection.close()
        except BaseException:
            # Keep the resources and exchange strongly referenced for cleanup,
            # but never admit a second job into this unresolved process/pipe.
            self.faulted = True
            raise
        self.process, self.connection = None, None

    async def _drain_exchange(self):
        task = self.pending_exchange
        if task is None:
            return
        done, _ = await asyncio.wait({task}, timeout=2)
        if not done:
            self.faulted = True
            raise WorkerFailure("native_exchange_not_reaped")
        with suppress(Exception, asyncio.CancelledError):
            task.result()
        self.pending_exchange = None

    async def run(self, job: dict) -> dict:
        async with self.lock:
            if self.faulted or self.pending_exchange is not None:
                raise WorkerFailure("native_worker_not_reaped")
            if self.process is None:
                self._start()
            connection = self.connection

            def exchange():
                connection.send(job)
                return connection.recv()

            task = asyncio.create_task(asyncio.to_thread(exchange))
            self.pending_exchange = task

            def consume_completion(completed):
                with suppress(Exception, asyncio.CancelledError):
                    completed.exception()

            task.add_done_callback(consume_completion)
            try:
                value = await asyncio.wait_for(asyncio.shield(task), self.timeout)
                if not isinstance(value, dict):
                    raise WorkerFailure("native_invalid_output")
                if "error" in value:
                    # Child emits only fixed service error codes.
                    raise WorkerFailure(value["error"])
                return value["ok"]
            except TimeoutError:
                await self._stop()
                await self._drain_exchange()
                raise WorkerFailure("native_worker_timeout") from None
            except asyncio.CancelledError:
                await self._stop()
                await self._drain_exchange()
                raise
            except (EOFError, BrokenPipeError, OSError, KeyError):
                await self._stop()
                await self._drain_exchange()
                raise WorkerFailure("native_worker_unavailable") from None
            finally:
                if task.done() and self.pending_exchange is task:
                    self.pending_exchange = None

    async def close(self):
        async with self.lock:
            await self._stop()
            await self._drain_exchange()
            self.faulted = False


@dataclass(frozen=True)
class Evidence:
    evidence_id: str
    incident_id: str
    source_id: str
    content_type: str
    data: bytes
    expires: float


class EvidenceBuffer:
    """Opaque authenticated references; byte, item, and TTL limits all apply."""

    def __init__(self, settings: Settings):
        self.settings = settings
        self.items: OrderedDict[str, Evidence] = OrderedDict()
        self.total_bytes = 0

    def _remove(self, key: str):
        self.total_bytes -= len(self.items.pop(key).data)

    def prune(self):
        now = time.monotonic()
        for key, item in list(self.items.items()):
            if item.expires <= now:
                self._remove(key)

    def put(self, incident_id: str, source_id: str, content_type: str, data: bytes) -> str | None:
        self.prune()
        if len(data) > self.settings.live_evidence_max_bytes:
            return None
        while self.items and (
            len(self.items) >= self.settings.live_evidence_max_items
            or self.total_bytes + len(data) > self.settings.live_evidence_max_bytes
        ):
            self._remove(next(iter(self.items)))
        key = "ev-" + str(uuid.uuid4())
        self.items[key] = Evidence(
            key,
            incident_id,
            source_id,
            content_type,
            data,
            time.monotonic() + self.settings.live_evidence_ttl_seconds,
        )
        self.total_bytes += len(data)
        return key

    def get(self, key: str) -> Evidence | None:
        self.prune()
        return self.items.get(key)

    def clear(self):
        self.items.clear()
        self.total_bytes = 0


@dataclass
class QueuedMedia:
    request: MediaRequest
    receipt: MediaReceipt
    admitted_monotonic: float


class LiveMedia:
    def __init__(
        self,
        settings: Settings,
        store,
        *,
        detector_worker=None,
        audio_worker=None,
        context_provider=None,
    ):
        self.settings, self.store = settings, store
        self.detector = detector_worker or NativeWorker(
            settings, "frame", settings.live_detector_timeout_seconds
        )
        self.audio = audio_worker or NativeWorker(
            settings, "audio", settings.live_asr_timeout_seconds
        )
        self.context = context_provider or _context_provider(settings)
        self.evidence_buffer = EvidenceBuffer(settings)
        self.frames: OrderedDict[str, QueuedMedia] = OrderedDict()
        self.clips: deque[QueuedMedia] = deque()
        self.contexts: OrderedDict[str, tuple[MediaResult, str, int]] = OrderedDict()
        self.dedupe: OrderedDict[tuple[str, str, int], tuple[str, MediaReceipt]] = OrderedDict()
        self.latest: dict[str, tuple[str, int, datetime]] = {}
        self.last_context: dict[str, float] = {}
        self.wakes = {kind: asyncio.Event() for kind in ("frame", "audio", "context")}
        self.tasks: list[asyncio.Task] = []
        self.running = False
        self.context_faulted = False

    async def start(self):
        if self.running:
            return
        self.running = True
        self.tasks = [asyncio.create_task(self._loop(kind)) for kind in self.wakes]
        self.tasks.append(asyncio.create_task(self._maintenance()))

    async def _maintenance(self):
        while self.running:
            self.evidence_buffer.prune()
            await asyncio.sleep(min(1, self.settings.live_evidence_ttl_seconds))

    async def close(self):
        self.running = False
        for task in self.tasks:
            task.cancel()
        await asyncio.gather(*self.tasks, return_exceptions=True)
        await asyncio.gather(self.detector.close(), self.audio.close(), self.context.close())
        self.frames.clear()
        self.clips.clear()
        self.contexts.clear()
        self.dedupe.clear()
        self.evidence_buffer.clear()

    def _source(self, principal: LivePrincipal, source_id: str, incident_id: str):
        require_incident(principal, incident_id)
        source = next(
            (
                source
                for source in self.settings.live_sources
                if source.source_id == source_id and source.incident_id == incident_id
            ),
            None,
        )
        if source is None or not source_visible(principal, source.model_dump()):
            raise LiveError(403, "source_forbidden")
        return source

    def admit(self, principal: LivePrincipal, request: MediaRequest, *, now=None) -> MediaReceipt:
        if not self.settings.live_media_enabled or not self.running:
            raise LiveError(503, "live_media_unavailable")
        if principal.role != "source":
            raise LiveError(403, "source_forbidden")
        source = self._source(principal, request.source_id, request.incident_id)
        if source.kind != ("camera" if request.kind == "frame" else "microphone"):
            raise LiveError(422, "source_kind_mismatch")
        now = now or datetime.now(UTC)
        age = (now - request.captured_at).total_seconds()
        max_age = self._max_age(request.kind)
        if age < -2 or age > max_age:
            raise LiveError(422, "media_capture_time_outside_window")
        try:
            raw = base64.b64decode(request.data_base64, validate=True)
        except (ValueError, binascii.Error):
            raise LiveError(422, "invalid_base64") from None
        if not raw:
            raise LiveError(422, "empty_media")
        # Include all metadata so retrying an identity with changed capture time or MIME fails.
        digest = hashlib.sha256(request.model_dump_json().encode()).hexdigest()
        key = (request.source_id, request.boot_id, request.sequence)
        if key in self.dedupe:
            previous_digest, receipt = self.dedupe[key]
            if digest != previous_digest:
                raise LiveError(409, "media_identity_conflict")
            return receipt.model_copy(update={"status": "duplicate"})
        previous = self.latest.get(request.source_id)
        if previous and (
            request.captured_at <= previous[2]
            or (request.boot_id == previous[0] and request.sequence <= previous[1])
        ):
            raise LiveError(409, "media_out_of_order")
        replacing = request.kind == "frame" and request.source_id in self.frames
        if (
            request.kind == "frame"
            and not replacing
            and len(self.frames) >= self.settings.live_frame_queue_sources
        ):
            raise LiveError(429, "frame_queue_full")
        if request.kind == "audio" and len(self.clips) >= self.settings.live_audio_queue_size:
            raise LiveError(429, "audio_queue_full")
        receipt = MediaReceipt(
            media_id="media-" + str(uuid.uuid4()),
            incident_id=request.incident_id,
            source_id=request.source_id,
            kind=request.kind,
            status="replaced" if replacing else "accepted",
        )
        queued = QueuedMedia(request, receipt, time.monotonic())
        if request.kind == "frame":
            self.frames[request.source_id] = queued
        else:
            self.clips.append(queued)
        self.dedupe[key] = (digest, receipt)
        while len(self.dedupe) > self.settings.live_media_dedupe_entries:
            self.dedupe.popitem(last=False)
        self.latest[request.source_id] = (request.boot_id, request.sequence, request.captured_at)
        self.wakes[request.kind].set()
        return receipt

    def evidence(self, principal: LivePrincipal, evidence_id: str) -> Evidence:
        item = self.evidence_buffer.get(evidence_id)
        if item is None:
            raise LiveError(404, "evidence_expired_or_missing")
        if principal.role == "source":
            raise LiveError(403, "evidence_forbidden")
        self._source(principal, item.source_id, item.incident_id)
        return item

    def _max_age(self, kind: str) -> float:
        return (
            self.settings.live_media_frame_max_age_seconds
            if kind == "frame"
            else self.settings.live_media_audio_max_age_seconds
        )

    async def _loop(self, kind: str):
        wake = self.wakes[kind]
        while self.running:
            await wake.wait()
            wake.clear()
            if kind == "context":
                while self.contexts:
                    _, job = self.contexts.popitem(last=False)
                    await self._process_context(*job)
            elif kind == "frame":
                while self.frames:
                    _, job = self.frames.popitem(last=False)
                    await self._process(job)
            else:
                while self.clips:
                    await self._process(self.clips.popleft())

    async def _process(self, job: QueuedMedia):
        request = job.request
        started = time.monotonic()
        warnings, detections, models, refs = [], [], [], []
        transcript, image_base64 = None, None
        status = "observed"
        try:
            if (datetime.now(UTC) - request.captured_at).total_seconds() > self._max_age(
                request.kind
            ):
                raise WorkerFailure("media_expired_in_queue")
            if isinstance(request, FrameMediaRequest):
                if not self.settings.yolo_enabled:
                    raise WorkerFailure("detector_disabled")
                output = await self.detector.run(
                    TriageRequest(
                        image_base64=request.data_base64,
                        media_type=request.media_type,
                        source_id=request.source_id,
                        incident_id=request.incident_id,
                        captured_at=request.captured_at,
                    ).model_dump(mode="json")
                )
                detections = [Detection.model_validate(value) for value in output["detections"]]
                models = [ModelProvenance.model_validate(value) for value in output["models"]]
                image_base64 = output["image_base64"]
                evidence_data = base64.b64decode(image_base64, validate=True)
                evidence_type = "image/jpeg"
            else:
                if not self.settings.transcription_enabled:
                    raise WorkerFailure("transcriber_disabled")
                with prepared_audio(
                    TranscriptionRequest(
                        audio_base64=request.data_base64,
                        media_type=request.media_type,
                        source_id=request.source_id,
                        incident_id=request.incident_id,
                        captured_at=request.captured_at,
                    ),
                    self.settings,
                ) as prepared:
                    output = await self.audio.run(
                        {
                            "path": prepared.path,
                            "sha256": prepared.sha256,
                            "byte_count": prepared.byte_count,
                        }
                    )
                models = [ModelProvenance.model_validate(value) for value in output["models"]]
                transcript = TranscriptionResult(
                    request_id=job.receipt.media_id,
                    source_id=request.source_id,
                    incident_id=request.incident_id,
                    captured_at=request.captured_at,
                    processed_at=datetime.now(UTC),
                    audio_sha256=prepared.sha256,
                    text=output["text"],
                    speech_detected=bool(output["text"]),
                    language=output["language"],
                    language_probability=output["language_probability"],
                    duration_seconds=output["duration_seconds"],
                    segments=output["segments"],
                    models=models,
                    warnings=output["warnings"] + ["speech_is_unverified_hypothesis"],
                    timings_ms={"asr": output["elapsed_ms"]},
                )
                if transcript.duration_seconds > self._max_age("audio") or any(
                    segment.end_seconds > transcript.duration_seconds + 0.1
                    for segment in transcript.segments
                ):
                    raise WorkerFailure("transcript_time_bounds_invalid")
                warnings.extend(transcript.warnings)
                evidence_data = base64.b64decode(request.data_base64, validate=True)
                evidence_type = request.media_type
            if (datetime.now(UTC) - request.captured_at).total_seconds() > self._max_age(
                request.kind
            ):
                raise WorkerFailure("media_expired_during_inference")
            reference = self.evidence_buffer.put(
                request.incident_id, request.source_id, evidence_type, evidence_data
            )
            if reference:
                refs.append(reference)
            else:
                warnings.append("evidence_capacity_unavailable")
        except (WorkerFailure, AudioError) as error:
            status = "unavailable"
            warnings.append(error.code)
            detections, models, transcript, image_base64 = [], [], None, None
        except Exception:
            status = "unavailable"
            warnings.append("media_inference_invalid_or_unavailable")
            detections, models, transcript, image_base64 = [], [], None, None
        result = MediaResult(
            media_id=job.receipt.media_id,
            incident_id=request.incident_id,
            source_id=request.source_id,
            kind=request.kind,
            boot_id=request.boot_id,
            sequence=request.sequence,
            captured_at=request.captured_at,
            processed_at=datetime.now(UTC),
            status=status,
            evidence_refs=refs,
            detections=detections,
            transcript=transcript,
            models=models,
            warnings=list(dict.fromkeys(warnings))[:20],
            timings_ms={
                "queue": (started - job.admitted_monotonic) * 1000,
                "processing": (time.monotonic() - started) * 1000,
            },
        )
        try:
            revision = self.store.publish_media(result)
        except Exception:
            # Do not kill an independent worker loop if persistence is temporarily unavailable.
            return
        if (
            self.settings.live_context_enabled
            and not self.context_faulted
            and image_base64
            and refs
        ):
            previous = self.last_context.get(request.incident_id, float("-inf"))
            if time.monotonic() - previous >= self.settings.live_context_interval_seconds:
                if (
                    request.incident_id in self.contexts
                    or len(self.contexts) < self.settings.live_context_queue_size
                ):
                    self.contexts[request.incident_id] = (result, image_base64, revision)
                    self.wakes["context"].set()

    async def _process_context(self, result: MediaResult, image_base64: str, revision: int):
        self.last_context[result.incident_id] = time.monotonic()
        if any(self.evidence_buffer.get(reference) is None for reference in result.evidence_refs):
            return
        try:
            async with asyncio.timeout(self.settings.live_context_timeout_seconds):
                inference = await self.context.assess(image_base64, result.detections)
            # Only the descriptive summary/limitations cross this boundary. The VLM's
            # hazard categories, severity and proposed actions have no policy authority.
            summary = ContextSummary(
                context_id="context-" + str(uuid.uuid4()),
                incident_id=result.incident_id,
                source_id=result.source_id,
                snapshot_revision=revision,
                generated_at=datetime.now(UTC),
                evidence_refs=result.evidence_refs,
                summary=inference.assessment.summary,
                limitations=inference.assessment.limitations,
                model=inference.provenance,
            )
            if all(
                self.evidence_buffer.get(reference) is not None
                for reference in summary.evidence_refs
            ):
                self.store.publish_context(summary)
        except TimeoutError:
            # An HTTP cancellation does not prove the external runner released its
            # GPU work. Stop admitting context until service restart, bounding the
            # number of potentially orphaned generations to one.
            self.context_faulted = True
            self.contexts.clear()
        except ProviderError as error:
            if error.code == "provider_timeout":
                self.context_faulted = True
                self.contexts.clear()
        except Exception:
            return
