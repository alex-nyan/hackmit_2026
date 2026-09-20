"""Configuration is validated once at startup and fails closed."""

from pathlib import Path
from typing import Literal
from urllib.parse import urlsplit

from pydantic import Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from triage.live_schemas import Identifier, LivePrincipal, PatientEnrollment, SourceEnrollment


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
    live_patients: list[PatientEnrollment] = Field(default_factory=list, max_length=100)
    live_handoffs_per_patient: int = Field(default=20, ge=1, le=100)
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
    live_media_enabled: bool = False
    live_media_max_request_bytes: int = Field(default=1_500_000, ge=1024, le=2_000_000)
    live_media_ingress_limit: int = Field(default=2, ge=1, le=8)
    live_telemetry_ingress_limit: int = Field(default=8, ge=1, le=32)
    live_command_ingress_limit: int = Field(default=4, ge=1, le=16)
    live_frame_queue_sources: int = Field(default=8, ge=1, le=32)
    live_audio_queue_size: int = Field(default=4, ge=1, le=32)
    live_media_frame_max_age_seconds: float = Field(default=3, ge=0.1, le=30)
    live_media_audio_max_age_seconds: float = Field(default=15, ge=1, le=60)
    live_detector_timeout_seconds: float = Field(default=10, ge=0.1, le=60)
    live_asr_timeout_seconds: float = Field(default=20, ge=0.1, le=120)
    live_evidence_ttl_seconds: float = Field(default=120, ge=1, le=900)
    live_evidence_max_bytes: int = Field(default=16_000_000, ge=1024, le=100_000_000)
    live_evidence_max_items: int = Field(default=32, ge=1, le=256)
    live_media_dedupe_entries: int = Field(default=2048, ge=10, le=10_000)
    live_context_enabled: bool = False
    live_context_interval_seconds: float = Field(default=5, ge=0.1, le=300)
    live_context_timeout_seconds: float = Field(default=20, ge=0.1, le=120)
    live_context_queue_size: int = Field(default=2, ge=1, le=8)
    live_evaluated_weapon_labels: list[str] = Field(default_factory=list, max_length=20)
    live_media_results_per_incident: int = Field(default=32, ge=1, le=256)
    live_alert_dedupe_seconds: float = Field(default=5, ge=0.1, le=30)

    @model_validator(mode="after")
    def valid_deployment(self):
        token = self.api_token.get_secret_value()
        if not token.isascii() or any(character.isspace() for character in token):
            raise ValueError("API token must be ASCII without whitespace")
        if self.live_media_enabled and not self.live_enabled:
            raise ValueError("live media requires enabled live incidents")
        if self.live_context_enabled and not self.live_media_enabled:
            raise ValueError("live context requires enabled live media")
        if any(not label.strip() or len(label) > 80 for label in self.live_evaluated_weapon_labels):
            raise ValueError("evaluated detector labels must be non-empty bounded strings")
        if self.live_enabled:
            if not self.live_incident_ids or not self.live_principals:
                raise ValueError("live mode requires explicit incidents and principals")
            incident_ids = set(self.live_incident_ids)
            if len(incident_ids) != len(self.live_incident_ids):
                raise ValueError("duplicate live incident")
            source_ids = {source.source_id for source in self.live_sources}
            patient_ids = {patient.patient_id for patient in self.live_patients}
            if len(patient_ids) != len(self.live_patients):
                raise ValueError("duplicate live patient")
            if any(patient.incident_id not in incident_ids for patient in self.live_patients):
                raise ValueError("patient references unknown incident")
            patients = {patient.patient_id: patient for patient in self.live_patients}
            for source in self.live_sources:
                if source.wearer_role == "patient" and (
                    source.wearer_id not in patients
                    or patients[source.wearer_id].incident_id != source.incident_id
                ):
                    raise ValueError("patient Watch wearer must match enrolled incident patient")
            if len(source_ids) != len(self.live_sources):
                raise ValueError("duplicate live source")
            if any(source.incident_id not in incident_ids for source in self.live_sources):
                raise ValueError("source references unknown incident")
            for incident_id in incident_ids:
                current_capacity = sum(
                    3
                    if source.kind == "camera"
                    else 2
                    if source.kind in {"watch", "gps", "microphone"}
                    else 1
                    for source in self.live_sources
                    if source.incident_id == incident_id
                )
                if current_capacity > self.live_max_observations_per_incident:
                    raise ValueError("observation capacity must preserve current enrolled sources")
                media_capacity = sum(
                    2 if source.kind == "camera" else 1
                    for source in self.live_sources
                    if source.incident_id == incident_id and source.kind in {"camera", "microphone"}
                )
                if media_capacity > self.live_media_results_per_incident:
                    raise ValueError("media capacity must preserve current enrolled sources")
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
                if not set(principal.patient_ids) <= patient_ids:
                    raise ValueError("principal references unknown patient")
                if any(
                    patient.patient_id in principal.patient_ids
                    and patient.incident_id not in principal.incident_ids
                    for patient in self.live_patients
                ):
                    raise ValueError("patient scope must be inside principal incident scope")
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
