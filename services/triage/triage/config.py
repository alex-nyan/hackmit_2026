"""Configuration is validated once at startup and fails closed."""

from pathlib import Path
from typing import Literal
from urllib.parse import urlsplit

from pydantic import Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="TRIAGE_", env_file=".env", extra="ignore", hide_input_in_errors=True
    )

    api_token: SecretStr = Field(min_length=32)
    ollama_base_url: str = "http://127.0.0.1:11434"
    ollama_model: str = "gemma4:26b"
    vision_provider: Literal["ollama", "openai_compatible"] = "ollama"
    cloud_enabled: bool = False
    cloud_fallback_enabled: bool = False
    cloud_base_url: str | None = None
    cloud_api_key: SecretStr | None = None
    cloud_model: str | None = None
    provider_timeout_seconds: float = Field(default=90, ge=1, le=300)
    max_response_bytes: int = Field(default=131_072, ge=1024, le=1_048_576)
    yolo_enabled: bool = True
    yolo_weights: Path = Path("models/yolo26n.pt")
    yolo_sha256: str | None = Field(default=None, pattern=r"^[a-f0-9]{64}$")
    yolo_device: str = "cpu"
    yolo_confidence: float = Field(default=0.25, ge=0.01, le=1)
    yolo_max_detections: int = Field(default=100, ge=1, le=300)
    max_request_bytes: int = Field(default=11_300_000, ge=1024, le=12_000_000)
    request_read_timeout_seconds: float = Field(default=15, ge=1, le=120)
    max_image_bytes: int = Field(default=8_000_000, ge=1024, le=8_000_000)
    max_image_pixels: int = Field(default=16_000_000, ge=1024, le=16_000_000)
    image_max_side: int = Field(default=1568, ge=128, le=2048)
    max_frame_age_seconds: int = Field(default=300, ge=1, le=86_400)
    max_concurrency: int = Field(default=1, ge=1, le=8)
    transcription_enabled: bool = False
    whisper_model: str = "base"
    whisper_device: str = "cpu"
    whisper_compute_type: str = "int8"
    whisper_beam_size: int = Field(default=1, ge=1, le=10)
    max_audio_bytes: int = Field(default=8_000_000, ge=1024, le=8_000_000)
    max_audio_seconds: float = Field(default=120, ge=1, le=900)
    max_clip_age_seconds: int = Field(default=900, ge=1, le=86_400)
    database_path: Path = Path("data/triage.sqlite3")
    retention_hours: int = Field(default=24, ge=1, le=168)
    max_records: int = Field(default=10_000, ge=1, le=100_000)

    @model_validator(mode="after")
    def valid_deployment(self):
        token = self.api_token.get_secret_value()
        if not token.isascii() or any(character.isspace() for character in token):
            raise ValueError("API token must be ASCII without whitespace")
        local = urlsplit(self.ollama_base_url)
        if (
            local.scheme not in {"http", "https"}
            or local.hostname
            not in {"localhost", "127.0.0.1", "::1", "host.docker.internal", "ollama"}
            or local.username
            or local.password
            or local.query
            or local.fragment
            or local.path not in {"", "/"}
        ):
            raise ValueError(
                "Ollama must use an approved local host without URL credentials or path"
            )
        if self.vision_provider == "openai_compatible" or self.cloud_fallback_enabled:
            if not self.cloud_enabled:
                raise ValueError("cloud inference requires TRIAGE_CLOUD_ENABLED=true")
        if self.cloud_enabled:
            cloud = urlsplit(self.cloud_base_url or "")
            if (
                cloud.scheme != "https"
                or not cloud.hostname
                or cloud.username
                or cloud.password
                or cloud.query
                or cloud.fragment
                or not self.cloud_api_key
                or not self.cloud_model
            ):
                raise ValueError("cloud inference requires an HTTPS base URL, model, and API key")
        return self
