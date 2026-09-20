"""Decode once at the trust boundary; the model only ever sees a temporary file."""

import base64
import binascii
import hashlib
import os
import tempfile
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass

from triage.config import Settings
from triage.schemas import TranscriptionRequest

_SUFFIXES = {
    "audio/mp4": ".m4a",
    "audio/aac": ".aac",
    "audio/mpeg": ".mp3",
    "audio/wav": ".wav",
    "audio/webm": ".webm",
    "audio/ogg": ".ogg",
}

# Container signatures, checked so a mislabelled media_type is refused rather
# than handed to a decoder. Offset 4 covers the ISO-BMFF "ftyp" box.
_SIGNATURES: dict[str, tuple[tuple[int, bytes], ...]] = {
    "audio/mp4": ((4, b"ftyp"),),
    "audio/aac": ((0, b"\xff\xf1"), (0, b"\xff\xf9"), (0, b"ADIF")),
    "audio/mpeg": ((0, b"ID3"), (0, b"\xff\xfb"), (0, b"\xff\xf3"), (0, b"\xff\xf2")),
    "audio/wav": ((0, b"RIFF"),),
    "audio/webm": ((0, b"\x1a\x45\xdf\xa3"),),
    "audio/ogg": ((0, b"OggS"),),
}


class AudioError(Exception):
    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


@dataclass
class PreparedAudio:
    path: str
    sha256: str
    byte_count: int


def _matches_signature(media_type: str, raw: bytes) -> bool:
    for offset, magic in _SIGNATURES.get(media_type, ()):
        if raw[offset : offset + len(magic)] == magic:
            return True
    return False


@contextmanager
def prepared_audio(request: TranscriptionRequest, settings: Settings) -> Iterator[PreparedAudio]:
    """
    Writes the clip to a private temporary file for the decoder and removes it
    on the way out, so audio of a person is never left on disk after the
    request that carried it.
    """
    try:
        raw = base64.b64decode(request.audio_base64, validate=True)
    except (binascii.Error, ValueError) as error:
        raise AudioError("invalid_base64") from error

    if not raw or len(raw) > settings.max_audio_bytes:
        raise AudioError("audio_size_limit")
    if not _matches_signature(request.media_type, raw):
        raise AudioError("audio_format_mismatch")

    digest = hashlib.sha256(raw).hexdigest()
    handle, path = tempfile.mkstemp(suffix=_SUFFIXES[request.media_type])
    try:
        with os.fdopen(handle, "wb") as sink:
            sink.write(raw)
        yield PreparedAudio(path=path, sha256=digest, byte_count=len(raw))
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass
