"""Speech to text. A transcript is a model hypothesis, never a record of speech."""

import asyncio
import threading
import time
from dataclasses import dataclass, field
from typing import Any, Protocol

from triage.audio import PreparedAudio
from triage.config import Settings
from triage.schemas import ModelProvenance, TranscriptSegment


class TranscriptionError(Exception):
    _CODES = frozenset(
        {
            "transcriber_unavailable",
            "transcriber_disabled",
            "transcriber_failed",
            "transcriber_invalid_output",
            "audio_too_long",
        }
    )

    def __init__(self, code: str):
        self.code = code if code in self._CODES else "transcriber_failed"
        super().__init__(self.code)


@dataclass
class Transcription:
    text: str
    language: str | None
    language_probability: float | None
    duration_seconds: float
    segments: list[TranscriptSegment] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


class Transcriber(Protocol):
    def transcribe(self, audio: PreparedAudio, language: str | None) -> Transcription: ...

    def provenance(self) -> ModelProvenance: ...

    def ready(self) -> bool: ...


def _clamp_probability(value: Any) -> float | None:
    if not isinstance(value, int | float):
        return None
    number = float(value)
    if number != number:  # NaN
        return None
    return min(1.0, max(0.0, number))


class FasterWhisperTranscriber:
    """
    Loads the model on first use and serializes access, because a Whisper model
    is mutable and not safe to share across threads. Import is deferred so the
    service runs without the optional dependency installed, reporting itself as
    unavailable rather than failing to start.
    """

    def __init__(self, settings: Settings):
        self.settings = settings
        self._lock = threading.Lock()
        self._model: Any = None
        self._load_failed = False

    def _ensure_model(self) -> Any:
        if self._model is not None:
            return self._model
        if self._load_failed:
            raise TranscriptionError("transcriber_unavailable")
        try:
            from faster_whisper import WhisperModel
        except ImportError as error:
            self._load_failed = True
            raise TranscriptionError("transcriber_unavailable") from error
        try:
            self._model = WhisperModel(
                self.settings.whisper_model,
                device=self.settings.whisper_device,
                compute_type=self.settings.whisper_compute_type,
            )
        except Exception as error:
            self._load_failed = True
            raise TranscriptionError("transcriber_unavailable") from error
        return self._model

    def transcribe(self, audio: PreparedAudio, language: str | None) -> Transcription:
        if not self.settings.transcription_enabled:
            raise TranscriptionError("transcriber_disabled")

        with self._lock:
            model = self._ensure_model()
            try:
                segments, info = model.transcribe(
                    audio.path,
                    language=language,
                    beam_size=self.settings.whisper_beam_size,
                    vad_filter=True,
                )
                collected = list(segments)
            except Exception as error:
                raise TranscriptionError("transcriber_failed") from error

        duration = float(getattr(info, "duration", 0.0) or 0.0)
        if duration > self.settings.max_audio_seconds:
            raise TranscriptionError("audio_too_long")

        return build_transcription(collected, info, duration)

    def provenance(self) -> ModelProvenance:
        return provenance_for(self.settings)

    def ready(self) -> bool:
        if not self.settings.transcription_enabled or self._load_failed:
            return False
        try:
            self._ensure_model()
        except TranscriptionError:
            return False
        return True


def build_transcription(raw_segments: list[Any], info: Any, duration: float) -> Transcription:
    """
    Normalises one decoder's output. Kept separate from the model so the shape
    of a transcript can be tested without the optional dependency present.
    """
    segments: list[TranscriptSegment] = []
    warnings: list[str] = []

    for raw in raw_segments[:500]:
        text = str(getattr(raw, "text", "") or "").strip()
        if not text:
            continue
        start = float(getattr(raw, "start", 0.0) or 0.0)
        end = float(getattr(raw, "end", start) or start)
        if end < start:
            end = start
        try:
            segments.append(
                TranscriptSegment(
                    start_seconds=start,
                    end_seconds=end,
                    text=text[:1000],
                    no_speech_probability=_clamp_probability(getattr(raw, "no_speech_prob", None)),
                )
            )
        except ValueError:
            warnings.append("segment_discarded")

    if len(raw_segments) > 500:
        warnings.append("segments_truncated")

    text = " ".join(segment.text for segment in segments).strip()
    if not text:
        # Silence and unrecognised speech are indistinguishable here, and the
        # difference matters to whoever reads this.
        warnings.append("no_speech_recognised")

    return Transcription(
        text=text[:20_000],
        language=(str(getattr(info, "language", "")) or None) if info is not None else None,
        language_probability=_clamp_probability(getattr(info, "language_probability", None)),
        duration_seconds=max(0.0, duration),
        segments=segments,
        warnings=warnings,
    )


def provenance_for(settings: Settings) -> ModelProvenance:
    return ModelProvenance(provider="faster_whisper", model=settings.whisper_model)


class TranscriptionService:
    """Times the work and attaches provenance, mirroring the vision pipeline."""

    def __init__(self, settings: Settings, *, transcriber: Transcriber | None = None):
        self.settings = settings
        self.transcriber = (
            transcriber if transcriber is not None else FasterWhisperTranscriber(settings)
        )

    async def process(
        self, audio: PreparedAudio, language: str | None
    ) -> tuple[Transcription, list[ModelProvenance], dict[str, float]]:
        started = time.monotonic()
        transcription = await asyncio.to_thread(self.transcriber.transcribe, audio, language)
        elapsed = (time.monotonic() - started) * 1000
        models = [await asyncio.to_thread(self.transcriber.provenance)]
        return transcription, models, {"transcriber": round(elapsed, 2)}

    async def ready(self) -> bool:
        if not self.settings.transcription_enabled:
            return False
        try:
            return bool(await asyncio.to_thread(self.transcriber.ready))
        except Exception:
            return False
