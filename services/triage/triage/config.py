"""Configuration is validated once at startup and fails closed."""

from pathlib import Path
from typing import Literal
from urllib.parse import urlsplit

from pydantic import Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from triage.live_schemas import Identifier, LivePrincipal, SourceEnrollment


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
    live_enabled: bool = False
    live_database_path: Path = Path("data/live.sqlite3")
    live_incident_ids: list[Identifier] = Field(default_factory=list, max_length=100)
    live_principals: list[LivePrincipal] = Field(default_factory=list, max_length=100)
    live_sources: list[SourceEnrollment] = Field(default_factory=list, max_length=100)
    live_max_request_bytes: int = Field(default=65_536, ge=1024, le=262_144)
    live_freshness_seconds: int = Field(default=30, ge=1, le=300)
    live_max_backfill_seconds: int = Field(default=86_400, ge=60, le=604_800)
    live_max_events_per_incident: int = Field(default=1000, ge=10, le=10_000)
    live_max_observations_per_incident: int = Field(default=128, ge=10, le=1000)
    live_max_alerts_per_incident: int = Field(default=256, ge=10, le=10_000)
    live_max_scene_reports_per_incident: int = Field(default=100, ge=10, le=1000)
    live_max_idempotency_records: int = Field(default=10_000, ge=100, le=100_000)
    live_sse_heartbeat_seconds: float = Field(default=10, ge=0.1, le=60)
    live_max_sse_connections: int = Field(default=32, ge=1, le=256)

    @model_validator(mode="after")
    def valid_deployment(self):
        token = self.api_token.get_secret_value()
        if not token.isascii() or any(character.isspace() for character in token):
            raise ValueError("API token must be ASCII without whitespace")
        if self.live_enabled:
            if not self.live_incident_ids or not self.live_principals:
                raise ValueError("live mode requires explicit incidents and principals")
            incident_ids = set(self.live_incident_ids)
            if len(incident_ids) != len(self.live_incident_ids):
                raise ValueError("duplicate live incident")
            source_ids = {source.source_id for source in self.live_sources}
            if len(source_ids) != len(self.live_sources):
                raise ValueError("duplicate live source")
            if any(source.incident_id not in incident_ids for source in self.live_sources):
                raise ValueError("source references unknown incident")
            for incident_id in incident_ids:
                current_capacity = sum(
                    2 if source.kind in {"watch", "gps"} else 1
                    for source in self.live_sources
                    if source.incident_id == incident_id
                )
                if current_capacity > self.live_max_observations_per_incident:
                    raise ValueError("observation capacity must preserve current enrolled sources")
            principal_ids = {principal.principal_id for principal in self.live_principals}
            tokens = {principal.token.get_secret_value() for principal in self.live_principals}
            if len(principal_ids) != len(self.live_principals):
                raise ValueError("duplicate live principal")
            if len(tokens) != len(self.live_principals) or token in tokens:
                raise ValueError("live tokens must be unique and distinct from the v1 token")
            for principal in self.live_principals:
                if not set(principal.incident_ids) <= incident_ids:
                    raise ValueError("principal references unknown incident")
                if not set(principal.source_ids) <= source_ids:
                    raise ValueError("principal references unknown source")
                if any(
                    source.source_id in principal.source_ids
                    and source.incident_id not in principal.incident_ids
                    for source in self.live_sources
                ):
                    raise ValueError("source scope must be inside principal incident scope")
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
