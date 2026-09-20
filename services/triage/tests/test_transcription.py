"""A transcript is a model hypothesis; these tests hold the service to saying so."""

import base64
import os
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta

import httpx
import pytest

from triage.app import create_app
from triage.audio import AudioError, prepared_audio
from triage.config import Settings
from triage.schemas import ModelProvenance, TranscriptionRequest
from triage.transcription import (
    FasterWhisperTranscriber,
    Transcription,
    TranscriptionError,
    TranscriptionService,
    build_transcription,
)

TOKEN = "t" * 32
HEADERS = {"Authorization": f"Bearer {TOKEN}"}
# A minimal ISO-BMFF header, enough to pass the container signature check.
M4A = b"\x00\x00\x00\x20ftypM4A " + b"\x00" * 64


class Segment:
    def __init__(self, start, end, text, no_speech_prob=None):
        self.start, self.end, self.text = start, end, text
        self.no_speech_prob = no_speech_prob


class Info:
    def __init__(self, language="en", language_probability=0.98, duration=3.0):
        self.language = language
        self.language_probability = language_probability
        self.duration = duration


class FakeTranscriber:
    def __init__(self, transcription=None, error=None):
        self.transcription = transcription
        self.error = error
        self.calls = []

    def transcribe(self, audio, language):
        self.calls.append((audio.sha256, language))
        if self.error:
            raise self.error
        return self.transcription or Transcription(
            text="dispatch we need backup",
            language="en",
            language_probability=0.98,
            duration_seconds=3.0,
            segments=[],
            warnings=[],
        )

    def provenance(self):
        return ModelProvenance(provider="faster_whisper", model="base")

    def ready(self):
        return True


class Pipeline:
    async def ready(self):
        return {"vision": True}

    async def close(self):
        return None


@asynccontextmanager
async def service(tmp_path, transcriber=None, **options):
    options.setdefault("transcription_enabled", True)
    settings = Settings(api_token=TOKEN, database_path=tmp_path / "r.sqlite3", **options)
    transcription = TranscriptionService(settings, transcriber=transcriber or FakeTranscriber())
    app = create_app(settings, Pipeline(), transcription)
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            yield client


def body(**overrides):
    payload = {
        "audio_base64": base64.b64encode(M4A).decode(),
        "media_type": "audio/mp4",
        "source_id": "unit-01",
        "captured_at": datetime.now(UTC).isoformat(),
    }
    payload.update(overrides)
    return payload


async def test_requires_authentication(tmp_path):
    async with service(tmp_path) as client:
        assert (await client.post("/v1/transcribe", json=body())).status_code == 401


async def test_returns_a_transcript_marked_as_a_hypothesis(tmp_path):
    async with service(tmp_path) as client:
        response = await client.post("/v1/transcribe", json=body(), headers=HEADERS)
        assert response.status_code == 200
        result = response.json()
        assert result["text"] == "dispatch we need backup"
        assert result["speech_detected"] is True
        # The payload must never let a caller treat this as a record of speech.
        assert result["transcript_semantics"] == "machine_hypothesis_not_verbatim_record"
        assert result["requires_human_review"] is True
        assert result["confidence_semantics"] == "uncalibrated_model_scores"
        assert result["models"][0]["provider"] == "faster_whisper"
        assert len(result["audio_sha256"]) == 64


async def test_disabled_by_default(tmp_path):
    async with service(tmp_path, transcription_enabled=False) as client:
        response = await client.post("/v1/transcribe", json=body(), headers=HEADERS)
        assert response.status_code == 503
        assert response.json()["error"]["code"] == "transcription_disabled"


async def test_rejects_audio_whose_bytes_contradict_its_media_type(tmp_path):
    async with service(tmp_path) as client:
        payload = body(audio_base64=base64.b64encode(b"not really audio at all").decode())
        response = await client.post("/v1/transcribe", json=payload, headers=HEADERS)
        assert response.status_code == 422
        assert response.json()["error"]["code"] == "audio_format_mismatch"


async def test_rejects_a_stale_clip(tmp_path):
    async with service(tmp_path, max_clip_age_seconds=60) as client:
        old = (datetime.now(UTC) - timedelta(minutes=10)).isoformat()
        response = await client.post("/v1/transcribe", json=body(captured_at=old), headers=HEADERS)
        assert response.status_code == 422
        assert response.json()["error"]["code"] == "stale_clip"


async def test_rejects_a_clip_from_the_future(tmp_path):
    async with service(tmp_path) as client:
        ahead = (datetime.now(UTC) + timedelta(minutes=5)).isoformat()
        response = await client.post(
            "/v1/transcribe", json=body(captured_at=ahead), headers=HEADERS
        )
        assert response.status_code == 422
        assert response.json()["error"]["code"] == "future_clip"


async def test_reports_an_unavailable_model_without_crashing(tmp_path):
    broken = FakeTranscriber(error=TranscriptionError("transcriber_unavailable"))
    async with service(tmp_path, transcriber=broken) as client:
        response = await client.post("/v1/transcribe", json=body(), headers=HEADERS)
        assert response.status_code == 503
        assert response.json()["error"]["code"] == "transcriber_unavailable"


async def test_passes_a_language_hint_through(tmp_path):
    fake = FakeTranscriber()
    async with service(tmp_path, transcriber=fake) as client:
        await client.post("/v1/transcribe", json=body(language="es"), headers=HEADERS)
        assert fake.calls[0][1] == "es"


async def test_silence_is_reported_as_no_speech_not_as_an_empty_success(tmp_path):
    quiet = FakeTranscriber(
        Transcription(
            text="",
            language=None,
            language_probability=None,
            duration_seconds=5.0,
            segments=[],
            warnings=["no_speech_recognised"],
        )
    )
    async with service(tmp_path, transcriber=quiet) as client:
        result = (await client.post("/v1/transcribe", json=body(), headers=HEADERS)).json()
        assert result["speech_detected"] is False
        assert "no_speech_recognised" in result["warnings"]


class TestAudioBoundary:
    def settings(self, tmp_path, **options):
        return Settings(api_token=TOKEN, database_path=tmp_path / "r.sqlite3", **options)

    def request(self, raw=M4A, media_type="audio/mp4"):
        return TranscriptionRequest(
            audio_base64=base64.b64encode(raw).decode(),
            media_type=media_type,
            source_id="unit-01",
            captured_at=datetime.now(UTC),
        )

    def test_writes_and_then_removes_the_clip(self, tmp_path):
        with prepared_audio(self.request(), self.settings(tmp_path)) as audio:
            path = audio.path
            assert os.path.exists(path)
            assert len(audio.sha256) == 64
        # Audio of a person must not outlive the request that carried it.
        assert not os.path.exists(path)

    def test_removes_the_clip_even_when_the_caller_raises(self, tmp_path):
        path = None
        with pytest.raises(RuntimeError):
            with prepared_audio(self.request(), self.settings(tmp_path)) as audio:
                path = audio.path
                raise RuntimeError("decoder blew up")
        assert path and not os.path.exists(path)

    def test_rejects_invalid_base64(self, tmp_path):
        request = self.request()
        object.__setattr__(request, "audio_base64", "!!!not base64!!!")
        with pytest.raises(AudioError) as error:
            with prepared_audio(request, self.settings(tmp_path)):
                pass
        assert error.value.code == "invalid_base64"

    def test_rejects_a_clip_over_the_byte_limit(self, tmp_path):
        big = b"\x00\x00\x00\x20ftypM4A " + b"\x00" * 5000
        with pytest.raises(AudioError) as error:
            with prepared_audio(self.request(big), self.settings(tmp_path, max_audio_bytes=1024)):
                pass
        assert error.value.code == "audio_size_limit"

    def test_accepts_each_declared_container(self, tmp_path):
        samples = {
            "audio/wav": b"RIFF" + b"\x00" * 40,
            "audio/ogg": b"OggS" + b"\x00" * 40,
            "audio/webm": b"\x1a\x45\xdf\xa3" + b"\x00" * 40,
            "audio/mpeg": b"ID3" + b"\x00" * 40,
        }
        for media_type, raw in samples.items():
            with prepared_audio(self.request(raw, media_type), self.settings(tmp_path)) as audio:
                assert os.path.exists(audio.path)


class TestTranscriptShape:
    def test_joins_segments_and_keeps_their_timings(self):
        result = build_transcription(
            [Segment(0.0, 1.5, " dispatch "), Segment(1.5, 3.0, " we need backup ")],
            Info(),
            3.0,
        )
        assert result.text == "dispatch we need backup"
        assert [s.start_seconds for s in result.segments] == [0.0, 1.5]
        assert result.language == "en"
        assert result.language_probability == 0.98

    def test_flags_that_no_speech_was_recognised(self):
        # Silence and unrecognised speech look identical here; say so.
        result = build_transcription([Segment(0.0, 1.0, "   ")], Info(), 1.0)
        assert result.text == ""
        assert "no_speech_recognised" in result.warnings

    def test_clamps_a_model_score_into_range(self):
        result = build_transcription([Segment(0.0, 1.0, "hi", no_speech_prob=1.7)], Info(), 1.0)
        assert result.segments[0].no_speech_probability == 1.0
        result = build_transcription([Segment(0.0, 1.0, "hi", no_speech_prob=-2)], Info(), 1.0)
        assert result.segments[0].no_speech_probability == 0.0

    def test_drops_a_score_that_is_not_a_number(self):
        result = build_transcription([Segment(0.0, 1.0, "hi", no_speech_prob="high")], Info(), 1.0)
        assert result.segments[0].no_speech_probability is None

    def test_repairs_a_segment_that_ends_before_it_starts(self):
        result = build_transcription([Segment(4.0, 1.0, "garbled")], Info(), 4.0)
        assert result.segments[0].end_seconds >= result.segments[0].start_seconds

    def test_truncates_an_unreasonable_number_of_segments(self):
        result = build_transcription([Segment(0.0, 0.1, "x")] * 600, Info(), 60.0)
        assert len(result.segments) == 500
        assert "segments_truncated" in result.warnings


class TestOptionalDependency:
    def test_reports_unavailable_rather_than_failing_to_start(self, tmp_path, monkeypatch):
        settings = Settings(
            api_token=TOKEN, database_path=tmp_path / "r.sqlite3", transcription_enabled=True
        )
        transcriber = FasterWhisperTranscriber(settings)
        monkeypatch.setitem(__import__("sys").modules, "faster_whisper", None)
        assert transcriber.ready() is False

    def test_refuses_when_transcription_is_switched_off(self, tmp_path):
        settings = Settings(
            api_token=TOKEN, database_path=tmp_path / "r.sqlite3", transcription_enabled=False
        )
        transcriber = FasterWhisperTranscriber(settings)
        with pytest.raises(TranscriptionError) as error:
            transcriber.transcribe(object(), None)
        assert error.value.code == "transcriber_disabled"

    def test_unknown_error_codes_collapse_to_a_generic_failure(self):
        assert TranscriptionError("something_new").code == "transcriber_failed"
