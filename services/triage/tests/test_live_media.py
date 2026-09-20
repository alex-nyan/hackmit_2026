"""Live inference isolation, admission, evidence authorization, and watchdog regressions."""

import asyncio
import base64
import os
import time
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from pydantic import TypeAdapter, ValidationError

from triage.config import Settings
from triage.live_media import EvidenceBuffer, LiveMedia, NativeWorker, WorkerFailure
from triage.live_media_schemas import AudioMediaRequest, FrameMediaRequest, MediaRequest
from triage.live_schemas import LivePrincipal
from triage.live_store import LiveError
from triage.providers import VisionInference
from triage.schemas import ModelProvenance, VisionAssessment

MEDIA_DEFAULTS = {
    "live_media_enabled": True,
    "live_frame_queue_sources": 2,
    "live_audio_queue_size": 2,
    "live_media_frame_max_age_seconds": 3,
    "live_media_audio_max_age_seconds": 15,
    "live_detector_timeout_seconds": 2,
    "live_asr_timeout_seconds": 2,
    "live_evidence_max_bytes": 1024,
    "live_evidence_max_items": 2,
    "live_evidence_ttl_seconds": 30,
    "live_media_dedupe_entries": 10,
    "live_context_enabled": True,
    "live_context_interval_seconds": 0,
    "live_context_timeout_seconds": 2,
    "live_context_queue_size": 2,
}


def settings(tmp_path, **overrides):
    configured = Settings(
        api_token="v" * 32,
        live_database_path=tmp_path / "live.sqlite",
        live_incident_ids=["incident-1"],
        live_sources=[
            {
                "source_id": "camera-1",
                "incident_id": "incident-1",
                "kind": "camera",
                "display_name": "Camera",
            },
            {
                "source_id": "camera-2",
                "incident_id": "incident-1",
                "kind": "camera",
                "display_name": "Camera 2",
            },
            {
                "source_id": "camera-3",
                "incident_id": "incident-1",
                "kind": "camera",
                "display_name": "Camera 3",
            },
            {
                "source_id": "mic-1",
                "incident_id": "incident-1",
                "kind": "microphone",
                "display_name": "Microphone",
            },
        ],
        transcription_enabled=True,
    )
    # model_copy permits subsecond watchdog/TTL values for deterministic short tests.
    return configured.model_copy(update={**MEDIA_DEFAULTS, **overrides})


def principal(role="source", sources=None, incidents=None):
    return LivePrincipal(
        principal_id="device" if role == "source" else role,
        role=role,
        token="s" * 32,
        incident_ids=incidents or ["incident-1"],
        source_ids=sources
        if sources is not None
        else ["camera-1", "camera-2", "camera-3", "mic-1"],
    )


def frame(sequence=0, source="camera-1", captured_at=None):
    return FrameMediaRequest(
        kind="frame",
        incident_id="incident-1",
        source_id=source,
        boot_id="boot-1",
        sequence=sequence,
        captured_at=captured_at or datetime.now(UTC),
        media_type="image/jpeg",
        data_base64=base64.b64encode(b"fake captured frame").decode(),
    )


def audio(sequence=0):
    return AudioMediaRequest(
        kind="audio",
        incident_id="incident-1",
        source_id="mic-1",
        boot_id="boot-1",
        sequence=sequence,
        captured_at=datetime.now(UTC),
        media_type="audio/wav",
        data_base64=base64.b64encode(b"RIFF" + b"test-wav-content" * 4).decode(),
    )


class FakeWorker:
    def __init__(self, block=None, audio_mode=False):
        self.block, self.audio_mode = block, audio_mode
        self.entered = asyncio.Event()
        self.jobs = []
        self.closed = False
        self.paths = []

    async def run(self, job):
        self.jobs.append(job)
        self.entered.set()
        if self.block:
            await self.block.wait()
        if self.audio_mode:
            self.paths.append(job["path"])
            assert await asyncio.to_thread(Path(job["path"]).is_file)
            return {
                "text": "no weapon seen",
                "language": "en",
                "language_probability": 0.7,
                "duration_seconds": 2,
                "segments": [
                    {
                        "start_seconds": 0,
                        "end_seconds": 2,
                        "text": "no weapon seen",
                        "no_speech_probability": 0.1,
                    }
                ],
                "warnings": [],
                "models": [{"provider": "faster_whisper", "model": "local-base", "revision": None}],
                "elapsed_ms": 1,
            }
        return {
            "detections": [
                {
                    "label": "knife",
                    "confidence": 0.8,
                    "bbox": {"x1": 0.1, "y1": 0.2, "x2": 0.4, "y2": 0.5},
                }
            ],
            "models": [{"provider": "ultralytics", "model": "fixture", "revision": "a" * 64}],
            "image_base64": base64.b64encode(b"sanitized jpeg").decode(),
            "sha256": "b" * 64,
            "elapsed_ms": 1,
        }

    async def close(self):
        self.closed = True


class FakeContext:
    def __init__(self, block=None):
        self.block = block
        self.entered = asyncio.Event()
        self.calls = 0
        self.closed = False

    async def assess(self, image, detections):
        self.calls += 1
        self.entered.set()
        if self.block:
            await self.block.wait()
        return VisionInference(
            VisionAssessment(
                summary="An object is visible",
                image_quality="limited",
                hazards=[],
                limitations=["Unverified single-frame context"],
            ),
            ModelProvenance(provider="ollama", model="fixture", revision="c" * 64),
        )

    async def close(self):
        self.closed = True


class FakeStore:
    def __init__(self):
        self.results, self.contexts = [], []
        self.revision = 0
        self.updated = asyncio.Event()

    def publish_media(self, result):
        self.results.append(result)
        self.revision += 1
        self.updated.set()
        return self.revision

    def publish_context(self, summary):
        if summary.snapshot_revision != self.revision:
            return False
        self.contexts.append(summary)
        self.revision += 1
        return True


async def result_count(store, count):
    async with asyncio.timeout(2):
        while len(store.results) < count:
            store.updated.clear()
            await store.updated.wait()


@pytest.mark.asyncio
async def test_newest_frame_replaces_only_pending_source_and_audio_has_separate_capacity(tmp_path):
    media = LiveMedia(
        settings(tmp_path),
        FakeStore(),
        detector_worker=FakeWorker(),
        audio_worker=FakeWorker(),
        context_provider=FakeContext(),
    )
    media.running = True  # Inspect admission before worker tasks drain queues.
    first = media.admit(principal(), frame())
    newer = frame(1)
    replacement = media.admit(principal(), newer)
    assert replacement.status == "replaced"
    assert len(media.frames) == 1
    assert media.frames["camera-1"].receipt.media_id != first.media_id
    assert media.admit(principal(), newer).status == "duplicate"
    media.admit(principal(), frame(source="camera-2"))
    with pytest.raises(LiveError, match="frame_queue_full"):
        media.admit(principal(), frame(source="camera-3"))
    media.admit(principal(), audio())
    media.admit(principal(), audio(1))
    with pytest.raises(LiveError, match="audio_queue_full"):
        media.admit(principal(), audio(2))
    await media.close()


@pytest.mark.asyncio
async def test_scope_clock_sequence_and_idempotency_checks_happen_before_queue_mutation(tmp_path):
    media = LiveMedia(
        settings(tmp_path),
        FakeStore(),
        detector_worker=FakeWorker(),
        audio_worker=FakeWorker(),
        context_provider=FakeContext(),
    )
    media.running = True
    with pytest.raises(LiveError, match="source_forbidden"):
        media.admit(principal("dispatch"), frame())
    with pytest.raises(LiveError, match="source_forbidden"):
        media.admit(principal(sources=["camera-2"]), frame())
    with pytest.raises(LiveError, match="source_kind_mismatch"):
        media.admit(principal(), frame(source="mic-1"))
    with pytest.raises(LiveError, match="media_capture_time_outside_window"):
        media.admit(principal(), frame(captured_at=datetime.now(UTC) - timedelta(seconds=5)))
    original = frame(2)
    media.admit(principal(), original)
    with pytest.raises(LiveError, match="media_identity_conflict"):
        media.admit(principal(), original.model_copy(update={"data_base64": "YWJj"}))
    with pytest.raises(LiveError, match="media_out_of_order"):
        media.admit(principal(), frame(1))
    assert len(media.frames) == 1
    await media.close()


@pytest.mark.asyncio
async def test_slow_context_does_not_block_detector_audio_or_control_and_stale_context_is_dropped(
    tmp_path,
):
    blocked = asyncio.Event()
    context = FakeContext(blocked)
    detector, asr, store = FakeWorker(), FakeWorker(audio_mode=True), FakeStore()
    media = LiveMedia(
        settings(tmp_path),
        store,
        detector_worker=detector,
        audio_worker=asr,
        context_provider=context,
    )
    await media.start()
    try:
        media.admit(principal(), frame())
        await result_count(store, 1)
        await asyncio.wait_for(context.entered.wait(), 1)
        media.admit(principal(), frame(1))
        media.admit(principal(), audio())
        await result_count(store, 3)
        assert len(detector.jobs) == 2
        assert any(
            result.transcript and result.transcript.text == "no weapon seen"
            for result in store.results
        )
        assert not any(
            await asyncio.gather(*(asyncio.to_thread(Path(path).exists) for path in asr.paths))
        )
        # An independently accepted human command advances the shared revision.
        store.revision += 1
        media.contexts.clear()
        blocked.set()
        await asyncio.sleep(0)
        await asyncio.sleep(0)
        assert not store.contexts
    finally:
        await media.close()


@pytest.mark.asyncio
async def test_context_timeout_opens_circuit_to_bound_orphaned_external_generations(tmp_path):
    context, store = FakeContext(asyncio.Event()), FakeStore()
    media = LiveMedia(
        settings(tmp_path, live_context_timeout_seconds=0.03),
        store,
        detector_worker=FakeWorker(),
        audio_worker=FakeWorker(),
        context_provider=context,
    )
    await media.start()
    try:
        media.admit(principal(), frame())
        await asyncio.wait_for(context.entered.wait(), 1)
        await asyncio.sleep(0.06)
        assert media.context_faulted
        media.admit(principal(), frame(1))
        await result_count(store, 2)
        assert context.calls == 1
    finally:
        await media.close()


@pytest.mark.asyncio
async def test_late_native_output_never_becomes_a_current_observation(tmp_path):
    blocked, store = asyncio.Event(), FakeStore()
    detector = FakeWorker(blocked)
    media = LiveMedia(
        settings(tmp_path, live_media_frame_max_age_seconds=0.03),
        store,
        detector_worker=detector,
        audio_worker=FakeWorker(),
        context_provider=FakeContext(),
    )
    await media.start()
    try:
        media.admit(principal(), frame())
        await asyncio.wait_for(detector.entered.wait(), 1)
        await asyncio.sleep(0.05)
        blocked.set()
        await result_count(store, 1)
        result = store.results[0]
        assert result.status == "unavailable"
        assert result.warnings == ["media_expired_during_inference"]
        assert result.detections == [] and result.evidence_refs == []
        assert not media.contexts
    finally:
        await media.close()


@pytest.mark.asyncio
async def test_evidence_is_scoped_bounded_and_expires_even_when_idle(tmp_path):
    configured = settings(tmp_path, live_evidence_max_bytes=8, live_evidence_ttl_seconds=0.03)
    media = LiveMedia(
        configured,
        FakeStore(),
        detector_worker=FakeWorker(),
        audio_worker=FakeWorker(),
        context_provider=FakeContext(),
    )
    await media.start()
    try:
        first = media.evidence_buffer.put("incident-1", "camera-1", "image/jpeg", b"12345")
        second = media.evidence_buffer.put("incident-1", "camera-1", "image/jpeg", b"abcde")
        assert media.evidence_buffer.get(first) is None
        assert media.evidence(principal("dispatch"), second).data == b"abcde"
        with pytest.raises(LiveError, match="source_forbidden"):
            media.evidence(principal("hospital", sources=[]), second)
        with pytest.raises(LiveError, match="evidence_forbidden"):
            media.evidence(principal(), second)
        with pytest.raises(LiveError, match="incident_forbidden"):
            media.evidence(principal("dispatch", incidents=["another-incident"]), second)
        await asyncio.sleep(0.07)
        assert not media.evidence_buffer.items and media.evidence_buffer.total_bytes == 0
    finally:
        await media.close()


def test_evidence_item_limit_and_oversized_item_refusal(tmp_path):
    buffer = EvidenceBuffer(settings(tmp_path))
    refs = [buffer.put("incident-1", "camera-1", "image/jpeg", b"x") for _ in range(3)]
    assert buffer.get(refs[0]) is None
    assert buffer.put("incident-1", "camera-1", "image/jpeg", b"x" * 1025) is None
    assert len(buffer.items) == 2


def test_media_discriminator_prevents_audio_from_being_labelled_as_a_frame():
    request = frame().model_dump(mode="json")
    request["media_type"] = "audio/wav"
    with pytest.raises(ValidationError):
        TypeAdapter(MediaRequest).validate_python(request)


def sleeping_native(connection, _settings, _kind):
    try:
        while True:
            job = connection.recv()
            if job.get("hang"):
                time.sleep(30)
            connection.send({"ok": {"pid": os.getpid()}})
    except EOFError:
        pass
    finally:
        connection.close()


@pytest.mark.asyncio
async def test_watchdog_reaps_hung_process_before_a_fresh_process_handles_next_job(tmp_path):
    worker = NativeWorker(settings(tmp_path), "frame", 2, target=sleeping_native)
    try:
        original = await worker.run({})
        worker.timeout = 0.05
        with pytest.raises(WorkerFailure, match="native_worker_timeout"):
            await worker.run({"hang": True})
        with pytest.raises(ProcessLookupError):
            os.kill(original["pid"], 0)
        worker.timeout = 2
        restarted = await worker.run({})
        assert restarted["pid"] != original["pid"]
    finally:
        await worker.close()


@pytest.mark.asyncio
async def test_cancelling_audio_processing_cleans_parent_owned_temporary_file(tmp_path):
    asr = FakeWorker(asyncio.Event(), audio_mode=True)
    media = LiveMedia(
        settings(tmp_path),
        FakeStore(),
        detector_worker=FakeWorker(),
        audio_worker=asr,
        context_provider=FakeContext(),
    )
    await media.start()
    media.admit(principal(), audio())
    await asyncio.wait_for(asr.entered.wait(), 1)
    path = Path(asr.jobs[0]["path"])
    assert await asyncio.to_thread(path.is_file)
    await media.close()
    assert not await asyncio.to_thread(path.exists)


@pytest.mark.asyncio
async def test_cancellation_reaps_native_work_instead_of_releasing_live_process(tmp_path):
    worker = NativeWorker(settings(tmp_path), "frame", 2, target=sleeping_native)
    original = await worker.run({})
    task = asyncio.create_task(worker.run({"hang": True}))
    await asyncio.sleep(0.03)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    with pytest.raises(ProcessLookupError):
        os.kill(original["pid"], 0)
    await worker.close()


@pytest.mark.asyncio
async def test_unreapable_process_latches_fault_and_never_receives_a_second_job(tmp_path):
    import threading

    released = threading.Event()

    class UnreapableProcess:
        alive = True

        def is_alive(self):
            return self.alive

        def kill(self):
            pass

        def join(self, _timeout):
            pass

        def close(self):
            assert not self.alive

    class PendingConnection:
        sends = 0
        closed = False

        def send(self, _job):
            self.sends += 1

        def recv(self):
            released.wait(5)
            return {"ok": {"finished": True}}

        def close(self):
            self.closed = True

    worker = NativeWorker(settings(tmp_path), "frame", 0.02)
    process, connection = UnreapableProcess(), PendingConnection()
    worker.process, worker.connection = process, connection
    try:
        with pytest.raises(WorkerFailure, match="native_worker_not_reaped"):
            await worker.run({"first": True})
        assert worker.faulted
        assert worker.pending_exchange is not None and not worker.pending_exchange.done()
        with pytest.raises(WorkerFailure, match="native_worker_not_reaped"):
            await worker.run({"must_not_send": True})
        assert connection.sends == 1
    finally:
        process.alive = False
        released.set()
        await worker.close()
    assert not worker.faulted and worker.pending_exchange is None and connection.closed
