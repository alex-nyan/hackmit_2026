"""A transcript is a model hypothesis; these tests hold the service to saying so."""

import base64
import os
import sys
import wave
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import httpx
import pytest

from triage.app import create_app
from triage.audio import AudioError, PreparedAudio, prepared_audio
from triage.config import Settings
from triage.schemas import ModelProvenance, TranscriptionRequest
from triage.transcription import (
    FasterWhisperTranscriber,
    Transcription,
    TranscriptionError,
    TranscriptionService,
    build_transcription,
    decode_bounded_audio,
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

    @pytest.mark.parametrize("second", [0xF0, 0xF1, 0xF8, 0xF9])
    def test_accepts_adts_with_or_without_crc(self, tmp_path, second):
        raw = bytes([0xFF, second]) + bytes(40)
        with prepared_audio(self.request(raw, "audio/aac"), self.settings(tmp_path)) as audio:
            assert audio.byte_count == len(raw)

    @pytest.mark.parametrize("second", [0xFA, 0xFB, 0xF2, 0xF3, 0xE2, 0xE3])
    def test_accepts_mpeg_versions_with_or_without_crc(self, tmp_path, second):
        raw = bytes([0xFF, second, 0x90, 0]) + bytes(40)
        with prepared_audio(self.request(raw, "audio/mpeg"), self.settings(tmp_path)) as audio:
            assert audio.byte_count == len(raw)

    @pytest.mark.parametrize(
        ("media_type", "header"),
        [
            ("audio/aac", b"\xff\xf2\x00\x00"),
            ("audio/mpeg", b"\xff\xea\x90\x00"),  # Reserved version.
            ("audio/mpeg", b"\xff\xf8\x90\x00"),  # Reserved layer.
            ("audio/mpeg", b"\xff\xfa\xf0\x00"),  # Reserved bitrate.
            ("audio/mpeg", b"\xff\xfa\x9c\x00"),  # Reserved sample rate.
        ],
    )
    def test_rejects_reserved_audio_header_bits(self, tmp_path, media_type, header):
        with pytest.raises(AudioError, match="audio_format_mismatch"):
            with prepared_audio(
                self.request(header + bytes(40), media_type), self.settings(tmp_path)
            ):
                pass


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


class TestBoundedDecoder:
    def test_stops_decoding_over_limit_before_loading_or_running_a_model(
        self, tmp_path, monkeypatch
    ):
        decoded_frames = []
        closed = []

        class Frame:
            samples = 16_000
            pts = 0

            def to_ndarray(self):
                return bytes(self.samples * 2)

        class Container:
            def __enter__(self):
                return self

            def __exit__(self, *args):
                closed.append(True)

            def decode(self, **kwargs):
                for index in range(100):
                    decoded_frames.append(index)
                    yield Frame()

        class Resampler:
            def __init__(self, **kwargs):
                assert kwargs == {"format": "s16", "layout": "mono", "rate": 16_000}

            def resample(self, frame):
                return [frame] if frame is not None else []

        monkeypatch.setitem(
            sys.modules,
            "av",
            SimpleNamespace(open=lambda *a, **kw: Container(), AudioResampler=Resampler),
        )
        # The limit must trigger before array conversion, independent of extras.
        monkeypatch.setitem(sys.modules, "numpy", SimpleNamespace())
        settings = Settings(
            api_token=TOKEN,
            database_path=tmp_path / "r.sqlite3",
            transcription_enabled=True,
            max_audio_seconds=1,
        )
        transcriber = FasterWhisperTranscriber(settings)
        monkeypatch.setattr(
            transcriber, "_ensure_model", lambda: pytest.fail("must reject before model load")
        )
        with pytest.raises(AudioError, match="audio_too_long"):
            transcriber.transcribe(PreparedAudio("clip.wav", "a" * 64, 1024), None)
        assert decoded_frames == [0, 1]
        assert closed == [True]

    def test_missing_decoder_dependency_is_reported_as_unavailable(self, monkeypatch):
        monkeypatch.setitem(sys.modules, "av", None)
        with pytest.raises(TranscriptionError, match="transcriber_unavailable"):
            decode_bounded_audio("clip.wav", 120)

    def test_passes_decoded_samples_to_whisper(self, tmp_path, monkeypatch):
        decoded = [0.0] * 16_000
        monkeypatch.setattr("triage.transcription.decode_bounded_audio", lambda *args: decoded)

        class Model:
            def transcribe(self, audio, **kwargs):
                assert audio is decoded
                assert kwargs["language"] == "en"
                return iter([Segment(0, 1, "hello")]), Info(duration=1000)

        settings = Settings(
            api_token=TOKEN, database_path=tmp_path / "r.sqlite3", transcription_enabled=True
        )
        transcriber = FasterWhisperTranscriber(settings)
        transcriber._model = Model()
        result = transcriber.transcribe(PreparedAudio("clip.wav", "a" * 64, 1024), "en")
        assert result.text == "hello"
        assert result.duration_seconds == 1

    def test_real_decoder_resamples_stereo_and_rejects_long_audio(self, tmp_path):
        pytest.importorskip("av")
        np = pytest.importorskip("numpy")
        path = tmp_path / "stereo.wav"
        with wave.open(str(path), "wb") as clip:
            clip.setnchannels(2)
            clip.setsampwidth(2)
            clip.setframerate(48_000)
            clip.writeframes(bytes(48_000 * 2 * 2))

        decoded = decode_bounded_audio(str(path), 1)
        assert decoded.shape == (16_000,)
        assert decoded.dtype == np.float32
        assert np.isfinite(decoded).all()
        with pytest.raises(AudioError, match="audio_too_long"):
            decode_bounded_audio(str(path), 0.5)
