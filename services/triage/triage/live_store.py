"""Atomic incident state and bounded durable replay. No model owns the control plane."""

import hashlib
import json
import sqlite3
import threading
import uuid
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from typing import Any

from triage.config import Settings
from triage.live_media_schemas import ContextSummary, MediaResult
from triage.live_schemas import (
    AlertCommand,
    AlertEvent,
    AssistanceCommand,
    Attribution,
    CommandReceipt,
    IncidentCommand,
    IncidentEvent,
    IncidentSnapshot,
    LivePrincipal,
    Observation,
    RevokeSceneReportCommand,
    SampleReceipt,
    SceneReport,
    SceneReportCommand,
    SourceState,
    TelemetryReceipt,
    TelemetryRequest,
)


class LiveError(Exception):
    def __init__(self, status: int, code: str):
        self.status, self.code = status, code
        super().__init__(code)


def canonical(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False)


def fingerprint(value: Any) -> str:
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def timestamp(value: str) -> datetime:
    return datetime.fromisoformat(value)


def require_incident(principal: LivePrincipal, incident_id: str) -> None:
    if incident_id not in principal.incident_ids:
        raise LiveError(403, "incident_forbidden")


def source_visible(principal: LivePrincipal, source: dict) -> bool:
    """Hospital wearable access requires an explicit patient-source grant."""
    if principal.role in {"source", "hospital"}:
        if source["source_id"] not in principal.source_ids:
            return False
    elif principal.source_ids and source["source_id"] not in principal.source_ids:
        return False
    return not (
        principal.role == "hospital"
        and source["kind"] == "watch"
        and source["wearer_role"] != "patient"
    )


class LiveStore:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.lock = threading.RLock()
        self.publication_failures: set[tuple[str, str]] = set()
        settings.live_database_path.parent.mkdir(parents=True, exist_ok=True)
        self.connection = sqlite3.connect(settings.live_database_path, check_same_thread=False)
        self.connection.row_factory = sqlite3.Row
        self.connection.execute("PRAGMA journal_mode=WAL")
        self.connection.execute("PRAGMA synchronous=FULL")
        self.connection.execute("PRAGMA busy_timeout=1000")
        self.connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS live_incidents (
                incident_id TEXT PRIMARY KEY, revision INTEGER NOT NULL, state TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS live_enrollments (
                source_id TEXT PRIMARY KEY, enrollment TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS live_events (
                incident_id TEXT NOT NULL, revision INTEGER NOT NULL, event TEXT NOT NULL,
                PRIMARY KEY (incident_id, revision)
            );
            CREATE TABLE IF NOT EXISTS live_samples (
                source_id TEXT NOT NULL, sample_id TEXT NOT NULL,
                fingerprint TEXT NOT NULL, receipt TEXT NOT NULL, received_at TEXT NOT NULL,
                PRIMARY KEY (source_id, sample_id)
            );
            CREATE TABLE IF NOT EXISTS live_commands (
                principal_id TEXT NOT NULL, incident_id TEXT NOT NULL, key TEXT NOT NULL,
                fingerprint TEXT NOT NULL, receipt TEXT NOT NULL,
                PRIMARY KEY (principal_id, incident_id, key)
            );
            CREATE TABLE IF NOT EXISTS live_media_keys (
                source_id TEXT NOT NULL, boot_id TEXT NOT NULL, sequence INTEGER NOT NULL,
                kind TEXT NOT NULL, media_id TEXT NOT NULL, revision INTEGER NOT NULL,
                PRIMARY KEY (source_id, boot_id, sequence, kind)
            );
            """
        )
        try:
            self._initialize()
        except Exception:
            self.connection.close()
            raise

    def close(self) -> None:
        with self.lock:
            self.connection.close()

    @contextmanager
    def _transaction(self):
        with self.lock:
            try:
                self.connection.execute("BEGIN IMMEDIATE")
                yield self.connection
                self.connection.commit()
            except sqlite3.Error:
                self.connection.rollback()
                raise LiveError(503, "live_store_unavailable") from None
            except BaseException:
                self.connection.rollback()
                raise

    def _initialize(self):
        now = datetime.now(UTC)
        with self._transaction() as connection:
            for incident_id in self.settings.live_incident_ids:
                state = {
                    "schema_version": "2.0",
                    "incident_id": incident_id,
                    "revision": 0,
                    "generated_at": now.isoformat(),
                    "sources": [],
                    "observations": [],
                    "alerts": [],
                    "scene_reports": [],
                    "runtime": {},
                }
                connection.execute(
                    "INSERT OR IGNORE INTO live_incidents VALUES (?, 0, ?)",
                    (incident_id, canonical(state)),
                )
            for source in self.settings.live_sources:
                encoded = canonical(source.model_dump(mode="json"))
                previous = connection.execute(
                    "SELECT enrollment FROM live_enrollments WHERE source_id=?",
                    (source.source_id,),
                ).fetchone()
                # Retained biometrics must never move to another wearer on a config reload.
                if previous and previous["enrollment"] != encoded:
                    raise LiveError(503, "enrollment_changed_requires_new_source_id")
                connection.execute(
                    "INSERT OR IGNORE INTO live_enrollments VALUES (?, ?)",
                    (source.source_id, encoded),
                )
                state = self._load(connection, source.incident_id)
                if not any(item["source_id"] == source.source_id for item in state["sources"]):
                    state["sources"].append(
                        SourceState(
                            **source.model_dump(),
                            availability="unknown",
                            last_received_at=None,
                            last_measured_at=None,
                            age_seconds=None,
                            sequence_gaps=0,
                            boot_id=None,
                            reason="no_samples_received",
                        ).model_dump(mode="json")
                    )
                    state["runtime"][source.source_id] = {"boots": {}, "latest": {}}
                    self._save(connection, state)
            # A process restart is a monitoring gap, even when the last sample is recent.
            for incident_id in self.settings.live_incident_ids:
                state = self._load(connection, incident_id)
                changed = False
                for source in state["sources"]:
                    if source["last_received_at"] is not None:
                        source["availability"] = "unknown"
                        source["reason"] = "service_restarted"
                        changed = True
                for observation in state["observations"]:
                    if observation["freshness"] != "historical":
                        observation["freshness"] = "stale"
                        if "monitoring_gap" not in observation["warnings"]:
                            observation["warnings"].append("monitoring_gap")
                if changed:
                    self._append_event(connection, state, "source_reset", now)

    def _load(self, connection, incident_id: str) -> dict:
        row = connection.execute(
            "SELECT state FROM live_incidents WHERE incident_id=?", (incident_id,)
        ).fetchone()
        if row is None or incident_id not in self.settings.live_incident_ids:
            raise LiveError(404, "incident_not_found")
        return json.loads(row["state"])

    def _save(self, connection, state: dict) -> None:
        connection.execute(
            "UPDATE live_incidents SET revision=?, state=? WHERE incident_id=?",
            (state["revision"], canonical(state), state["incident_id"]),
        )

    def _append_event(self, connection, state: dict, kind: str, now: datetime) -> IncidentEvent:
        state["revision"] += 1
        state["generated_at"] = now.isoformat()
        event = IncidentEvent(
            event_id=str(state["revision"]),
            incident_id=state["incident_id"],
            revision=state["revision"],
            kind=kind,
            recorded_at=now,
        )
        connection.execute(
            "INSERT INTO live_events VALUES (?, ?, ?)",
            (state["incident_id"], state["revision"], event.model_dump_json()),
        )
        connection.execute(
            "DELETE FROM live_events WHERE incident_id=? AND revision<=?",
            (state["incident_id"], state["revision"] - self.settings.live_max_events_per_incident),
        )
        self._save(connection, state)
        return event

    def snapshot(
        self,
        incident_id: str,
        principal: LivePrincipal | None = None,
        *,
        now: datetime | None = None,
    ) -> IncidentSnapshot:
        now = now or datetime.now(UTC)
        if principal:
            require_incident(principal, incident_id)
        try:
            with self.lock:
                state = self._load(self.connection, incident_id)
        except sqlite3.Error:
            raise LiveError(503, "live_store_unavailable") from None
        runtime = state.pop("runtime")
        configured = {source.source_id for source in self.settings.live_sources}
        state["sources"] = [
            source
            for source in state["sources"]
            if source["source_id"] in configured
            and (principal is None or source_visible(principal, source))
        ]
        visible = {source["source_id"] for source in state["sources"]}
        for source in state["sources"]:
            measured = source["last_measured_at"]
            source["age_seconds"] = (
                max(0, (now - timestamp(measured)).total_seconds()) if measured else None
            )
            source_limit = self._freshness_limit(
                {
                    "camera": "visual",
                    "microphone": "transcript",
                }.get(source["kind"], "source_health")
            )
            if (
                measured
                and source["age_seconds"] > source_limit
                and source["availability"] == "available"
            ):
                source["availability"] = "stale"
                source["reason"] = "no_recent_source_data"
            if self.settings.live_media_enabled and source["kind"] in {"camera", "microphone"}:
                media_kind = "visual" if source["kind"] == "camera" else "transcript"
                latest = runtime[source["source_id"]]["latest"].get(media_kind)
                machine = next(
                    (
                        item
                        for item in state["observations"]
                        if latest and item["observation_id"] == latest["observation_id"]
                    ),
                    None,
                )
                if (incident_id, source["source_id"]) in self.publication_failures:
                    source["availability"] = "unavailable"
                    source["reason"] = "inference_publication_unavailable"
                elif source["availability"] not in {"unavailable", "interrupted"}:
                    if machine is None:
                        source["availability"] = "unknown"
                        source["reason"] = "awaiting_inference"
                    elif machine["value"]["status"] == "unavailable":
                        source["availability"] = "unavailable"
                        source["reason"] = "inference_unavailable"
                    elif (now - timestamp(machine["measured_at"])).total_seconds() > source_limit:
                        source["availability"] = "stale"
                        source["reason"] = "no_recent_inference"
                    elif "monitoring_gap" in machine["warnings"]:
                        source["availability"] = "unknown"
                        source["reason"] = "service_restarted"
        state["observations"] = [
            item for item in state["observations"] if item["source_id"] in visible
        ]
        for observation in state["observations"]:
            age = max(0, (now - timestamp(observation["measured_at"])).total_seconds())
            observation["age_seconds"] = age
            if observation["freshness"] != "historical":
                observation["freshness"] = (
                    "stale"
                    if (
                        age > self._freshness_limit(observation["kind"])
                        or "monitoring_gap" in observation["warnings"]
                    )
                    else "fresh"
                )
            if observation["kind"] == "context" and (
                state["revision"] > observation["value"]["snapshot_revision"] + 1
            ):
                observation["freshness"] = "stale"
        state["alerts"] = [
            item
            for item in state["alerts"]
            if item["source_id"] is None or item["source_id"] in visible
        ]
        for alert in state["alerts"]:
            age = (now - timestamp(alert["observed_at"])).total_seconds()
            alert_limit = (
                self._freshness_limit("visual")
                if alert["kind"]
                in {
                    "possible_visible_weapon",
                    "visual_review",
                }
                else self.settings.live_freshness_seconds
            )
            alert["freshness"] = "stale" if age > alert_limit else "fresh"
        for report in state["scene_reports"]:
            report["effective"] = (
                report["revoked_by"] is None
                and now < timestamp(report["expires_at"])
                and not report["reassessment_required"]
            )
        state["generated_at"] = now.isoformat()
        return IncidentSnapshot.model_validate(state)

    def _freshness_limit(self, kind: str) -> float:
        if kind in {"visual", "context"}:
            return min(
                self.settings.live_freshness_seconds, self.settings.live_media_frame_max_age_seconds
            )
        if kind == "transcript":
            return min(
                self.settings.live_freshness_seconds, self.settings.live_media_audio_max_age_seconds
            )
        return self.settings.live_freshness_seconds

    def ingest(
        self,
        principal: LivePrincipal,
        payload: TelemetryRequest,
        *,
        now: datetime | None = None,
    ) -> TelemetryReceipt:
        now = now or datetime.now(UTC)
        require_incident(principal, payload.incident_id)
        if principal.role != "source" or payload.source_id not in principal.source_ids:
            raise LiveError(403, "source_forbidden")
        with self._transaction() as connection:
            state = self._load(connection, payload.incident_id)
            source = next(
                (s for s in state["sources"] if s["source_id"] == payload.source_id), None
            )
            configured = {s.source_id for s in self.settings.live_sources}
            if source is None or source["source_id"] not in configured:
                raise LiveError(403, "source_forbidden")
            runtime = state["runtime"][payload.source_id]
            receipts = []
            changed = False
            for sample in payload.samples:
                sample_fingerprint = fingerprint(sample.model_dump(mode="json"))
                existing = connection.execute(
                    "SELECT fingerprint, receipt FROM live_samples "
                    "WHERE source_id=? AND sample_id=?",
                    (payload.source_id, sample.sample_id),
                ).fetchone()
                if existing:
                    if existing["fingerprint"] != sample_fingerprint:
                        raise LiveError(409, "sample_id_conflict")
                    receipt = SampleReceipt.model_validate_json(existing["receipt"])
                    receipt.status = "duplicate"
                    receipts.append(receipt)
                    continue
                if sample.kind == "heart_rate" and source["kind"] != "watch":
                    raise LiveError(422, "source_kind_mismatch")
                if sample.kind == "location" and source["kind"] != "gps":
                    raise LiveError(422, "source_kind_mismatch")
                age = (now - sample.measured_at).total_seconds()
                if age < -10:
                    raise LiveError(422, "future_sample")
                if age > self.settings.live_max_backfill_seconds:
                    raise LiveError(422, "sample_outside_retention")
                if sample.kind == "heart_rate" and sample.value.measured_until is not None:
                    if sample.value.measured_until < sample.measured_at:
                        raise LiveError(422, "invalid_sample_interval")
                    if (sample.value.measured_until - now).total_seconds() > 10:
                        raise LiveError(422, "future_sample")
                warnings = []
                if age < 0:
                    warnings.append("clock_ahead")
                latest = runtime["latest"].get(sample.kind)
                highwater = runtime["boots"].get(sample.boot_id)
                historical = age > self.settings.live_freshness_seconds
                if historical:
                    warnings.append("stale_backfill")
                if latest and sample.measured_at <= timestamp(latest["measured_at"]):
                    historical = True
                    warnings.append("out_of_order")
                if highwater is not None and sample.sequence <= highwater:
                    historical = True
                    warnings.append("sequence_not_advanced")
                if highwater is not None and sample.sequence > highwater + 1:
                    warnings.append("sequence_gap")
                    source["sequence_gaps"] = min(
                        9_007_199_254_740_991,
                        source["sequence_gaps"] + sample.sequence - highwater - 1,
                    )
                if sample.boot_id not in runtime["boots"] and len(runtime["boots"]) >= 32:
                    # Late packets from a retired boot still cannot replace newer timestamps.
                    del runtime["boots"][next(iter(runtime["boots"]))]
                runtime["boots"][sample.boot_id] = max(sample.sequence, highwater or 0)
                observation_id = "obs-" + str(uuid.uuid4())
                observation = Observation(
                    observation_id=observation_id,
                    source_id=payload.source_id,
                    subject_id=source["wearer_id"] if sample.kind == "heart_rate" else None,
                    kind=sample.kind,
                    measured_at=sample.measured_at,
                    received_at=now,
                    boot_id=sample.boot_id,
                    sequence=sample.sequence,
                    value=sample.value,
                    freshness="historical" if historical else "fresh",
                    age_seconds=max(0, age),
                    warnings=warnings,
                )
                if not historical:
                    for previous in state["observations"]:
                        if (
                            previous["source_id"] == payload.source_id
                            and previous["kind"] == sample.kind
                        ):
                            previous["freshness"] = "historical"
                    runtime["latest"][sample.kind] = {
                        "measured_at": sample.measured_at.isoformat(),
                        "observation_id": observation_id,
                    }
                    if source["last_measured_at"] is None or sample.measured_at > timestamp(
                        source["last_measured_at"]
                    ):
                        source["last_measured_at"] = sample.measured_at.isoformat()
                    source["boot_id"] = sample.boot_id
                    if sample.kind == "source_health":
                        source["availability"] = sample.value.availability
                        source["reason"] = sample.value.reason
                    elif source["availability"] in {"unknown", "stale"}:
                        source["availability"] = "available"
                        source["reason"] = None
                source["last_received_at"] = now.isoformat()
                state["observations"].append(observation.model_dump(mode="json"))
                self._prune_observations(state)
                receipt = SampleReceipt(
                    sample_id=sample.sample_id,
                    status="historical" if historical else "accepted",
                    observation_id=observation_id,
                    warnings=warnings,
                )
                connection.execute(
                    "INSERT INTO live_samples VALUES (?, ?, ?, ?, ?)",
                    (
                        payload.source_id,
                        sample.sample_id,
                        sample_fingerprint,
                        receipt.model_dump_json(),
                        now.isoformat(),
                    ),
                )
                receipts.append(receipt)
                changed = True
            if changed:
                self._append_event(connection, state, "telemetry", now)
                connection.execute(
                    "DELETE FROM live_samples WHERE rowid IN (SELECT rowid FROM live_samples "
                    "ORDER BY rowid DESC LIMIT -1 OFFSET ?)",
                    (self.settings.live_max_idempotency_records,),
                )
            return TelemetryReceipt(
                incident_id=payload.incident_id,
                revision=state["revision"],
                results=receipts,
            )

    def command(
        self,
        principal: LivePrincipal,
        incident_id: str,
        key: str,
        command: IncidentCommand,
        *,
        now: datetime | None = None,
    ) -> tuple[CommandReceipt, bool]:
        now = now or datetime.now(UTC)
        require_incident(principal, incident_id)
        if principal.role == "source" and command.kind != "assistance":
            raise LiveError(403, "command_forbidden")
        if principal.role == "hospital" and command.kind not in {"assistance", "acknowledge"}:
            raise LiveError(403, "command_forbidden")
        digest = fingerprint(command.model_dump(mode="json"))
        with self._transaction() as connection:
            state = self._load(connection, incident_id)
            previous = connection.execute(
                "SELECT fingerprint, receipt FROM live_commands "
                "WHERE principal_id=? AND incident_id=? AND key=?",
                (principal.principal_id, incident_id, key),
            ).fetchone()
            if previous:
                if previous["fingerprint"] != digest:
                    raise LiveError(409, "idempotency_conflict")
                return CommandReceipt.model_validate_json(previous["receipt"]), True
            if (
                connection.execute("SELECT COUNT(*) FROM live_commands").fetchone()[0]
                >= self.settings.live_max_idempotency_records
            ):
                raise LiveError(503, "command_storage_capacity_reached")
            if (
                not isinstance(command, AssistanceCommand)
                and command.expected_revision != state["revision"]
            ):
                raise LiveError(409, "revision_conflict")
            attribution = Attribution(
                principal_id=principal.principal_id,
                role=principal.role,
                at=now,
                note=command.note,
            )
            alert_id, report_id = None, None
            if isinstance(command, AssistanceCommand):
                if command.source_id is not None:
                    source = next(
                        (s for s in state["sources"] if s["source_id"] == command.source_id), None
                    )
                    configured = {item.source_id for item in self.settings.live_sources}
                    if (
                        source is None
                        or command.source_id not in configured
                        or not source_visible(principal, source)
                    ):
                        raise LiveError(403, "source_forbidden")
                elif principal.role == "source":
                    raise LiveError(422, "assistance_source_required")
                self._make_alert_space(state)
                alert_id = "alert-" + str(uuid.uuid4())
                state["alerts"].append(
                    AlertEvent(
                        alert_id=alert_id,
                        kind="assistance_request",
                        claim=command.note,
                        source_id=command.source_id,
                        subject_id=None,
                        observed_at=now,
                        created_at=now,
                        priority="urgent_review",
                        evidence_status="human_reported",
                        attention="unacknowledged",
                        disposition="open",
                        freshness="fresh",
                        created_by=attribution,
                    ).model_dump(mode="json")
                )
                for report in state["scene_reports"]:
                    if report["status"] == "reported_clear" and report["revoked_by"] is None:
                        report["reassessment_required"] = True
                        report["effective"] = False
                event_kind = "assistance"
            elif isinstance(command, AlertCommand):
                alert_id = command.alert_id
                alert = next((a for a in state["alerts"] if a["alert_id"] == alert_id), None)
                if alert is None:
                    raise LiveError(404, "alert_not_found")
                if alert["source_id"] is not None:
                    source = next(
                        (s for s in state["sources"] if s["source_id"] == alert["source_id"]), None
                    )
                    configured = {item.source_id for item in self.settings.live_sources}
                    if (
                        source is None
                        or alert["source_id"] not in configured
                        or not source_visible(principal, source)
                    ):
                        raise LiveError(403, "source_forbidden")
                if command.kind == "acknowledge":
                    if alert["acknowledged_by"] is not None:
                        raise LiveError(409, "alert_already_acknowledged")
                    alert["attention"] = "acknowledged"
                    alert["acknowledged_by"] = attribution.model_dump(mode="json")
                    event_kind = "alert_acknowledged"
                elif command.kind == "reject":
                    if alert["rejected_by"] is not None:
                        raise LiveError(409, "alert_already_rejected")
                    alert["evidence_status"] = "human_rejected"
                    alert["rejected_by"] = attribution.model_dump(mode="json")
                    event_kind = "alert_rejected"
                else:
                    if alert["resolved_by"] is not None:
                        raise LiveError(409, "alert_already_resolved")
                    alert["disposition"] = "human_resolved"
                    alert["resolved_by"] = attribution.model_dump(mode="json")
                    event_kind = "alert_resolved"
            elif isinstance(command, SceneReportCommand):
                state["scene_reports"] = [
                    report
                    for report in state["scene_reports"]
                    if report["revoked_by"] is None and timestamp(report["expires_at"]) > now
                ]
                if len(state["scene_reports"]) >= self.settings.live_max_scene_reports_per_incident:
                    raise LiveError(503, "scene_report_capacity_reached")
                for previous_report in state["scene_reports"]:
                    if previous_report["scope"].casefold() == command.scope.casefold() or (
                        command.status != "reported_clear"
                        and previous_report["status"] == "reported_clear"
                    ):
                        previous_report["reassessment_required"] = True
                        previous_report["effective"] = False
                report_id = "report-" + str(uuid.uuid4())
                state["scene_reports"].append(
                    SceneReport(
                        report_id=report_id,
                        status=command.status,
                        scope=command.scope,
                        note=command.note,
                        reported_by=attribution,
                        expires_at=now + timedelta(seconds=command.valid_for_seconds),
                        effective=True,
                    ).model_dump(mode="json")
                )
                event_kind = "scene_reported"
            elif isinstance(command, RevokeSceneReportCommand):
                report_id = command.report_id
                report = next(
                    (r for r in state["scene_reports"] if r["report_id"] == report_id), None
                )
                if report is None:
                    raise LiveError(404, "scene_report_not_found")
                if report["revoked_by"] is not None:
                    raise LiveError(409, "scene_report_already_revoked")
                report["revoked_by"] = attribution.model_dump(mode="json")
                report["effective"] = False
                event_kind = "scene_report_revoked"
            else:
                raise LiveError(422, "unsupported_command")
            self._append_event(connection, state, event_kind, now)
            receipt = CommandReceipt(
                incident_id=incident_id,
                command_id="cmd-" + str(uuid.uuid4()),
                revision=state["revision"],
                alert_id=alert_id,
                report_id=report_id,
            )
            connection.execute(
                "INSERT INTO live_commands VALUES (?, ?, ?, ?, ?)",
                (principal.principal_id, incident_id, key, digest, receipt.model_dump_json()),
            )
            return receipt, False

    def _machine_source(self, state: dict, source_id: str, kind: str) -> dict:
        configured = next(
            (
                item
                for item in self.settings.live_sources
                if item.source_id == source_id and item.incident_id == state["incident_id"]
            ),
            None,
        )
        if configured is None or configured.kind != kind:
            raise LiveError(403, "machine_source_forbidden")
        return next(source for source in state["sources"] if source["source_id"] == source_id)

    @staticmethod
    def _retire_observations(state: dict, source_id: str, kind: str) -> None:
        for previous in state["observations"]:
            if previous["source_id"] == source_id and previous["kind"] == kind:
                previous["freshness"] = "historical"

    def _prune_machine_observations(self, state: dict) -> None:
        machine_kinds = {"visual", "transcript", "context"}
        while (
            sum(item["kind"] in machine_kinds for item in state["observations"])
            > self.settings.live_media_results_per_incident
        ):
            retired = next(
                (
                    index
                    for index, item in enumerate(state["observations"])
                    if item["kind"] in machine_kinds and item["freshness"] == "historical"
                ),
                None,
            )
            if retired is None:
                raise LiveError(503, "media_observation_capacity_reached")
            del state["observations"][retired]
        self._prune_observations(state)

    def publish_media(self, result: MediaResult, *, now: datetime | None = None) -> int:
        identity = (result.incident_id, result.source_id)
        try:
            revision, inserted = self._publish_media(result, now=now)
        except Exception:
            if any(
                (item.incident_id, item.source_id) == identity
                for item in self.settings.live_sources
            ):
                self.publication_failures.add(identity)
            raise
        if inserted:
            self.publication_failures.discard(identity)
        return revision

    def _publish_media(
        self,
        result: MediaResult,
        *,
        now: datetime | None = None,
    ) -> tuple[int, bool]:
        """Internal detector/ASR boundary; source tokens cannot publish these outputs.

        Persisted sequence identities survive process restarts. Received/processed
        time never replaces capture time when deciding source coverage or urgency.
        """
        if not self.settings.live_media_enabled:
            raise LiveError(503, "live_media_unavailable")
        now = now or datetime.now(UTC)
        age = (now - result.captured_at).total_seconds()
        if age < -2 or (result.processed_at - now).total_seconds() > 10:
            raise LiveError(422, "future_machine_result")
        if result.kind == "frame" and result.transcript is not None:
            raise LiveError(422, "machine_kind_mismatch")
        if result.kind == "audio" and result.detections:
            raise LiveError(422, "machine_kind_mismatch")
        if result.transcript is not None and (
            result.transcript.incident_id != result.incident_id
            or result.transcript.source_id != result.source_id
            or result.transcript.captured_at != result.captured_at
        ):
            raise LiveError(422, "machine_identity_mismatch")
        max_age = (
            self.settings.live_media_frame_max_age_seconds
            if result.kind == "frame"
            else self.settings.live_media_audio_max_age_seconds
        )
        stale = age > max_age
        with self._transaction() as connection:
            state = self._load(connection, result.incident_id)
            source = self._machine_source(
                state,
                result.source_id,
                "camera" if result.kind == "frame" else "microphone",
            )
            duplicate = connection.execute(
                "SELECT revision FROM live_media_keys "
                "WHERE source_id=? AND boot_id=? AND sequence=? AND kind=?",
                (result.source_id, result.boot_id, result.sequence, result.kind),
            ).fetchone()
            if duplicate:
                return duplicate["revision"], False
            kind = "visual" if result.kind == "frame" else "transcript"
            runtime = state["runtime"][result.source_id]
            previous = runtime["latest"].get(kind)
            historical = stale or (
                previous is not None and result.captured_at <= timestamp(previous["measured_at"])
            )
            warnings = list(result.warnings)
            if age < 0:
                warnings.append("clock_ahead")
            if historical:
                warnings.append("historical_machine_result")
            if result.status == "unavailable":
                warnings.append("inference_coverage_unavailable")
            if not historical:
                self._retire_observations(state, result.source_id, kind)
                self._retire_observations(state, result.source_id, "context")
                runtime["latest"][kind] = {
                    "measured_at": result.captured_at.isoformat(),
                    "observation_id": result.media_id,
                }
            observation = Observation(
                observation_id=result.media_id,
                source_id=result.source_id,
                subject_id=None,
                kind=kind,
                measured_at=result.captured_at,
                received_at=result.processed_at,
                boot_id=result.boot_id,
                sequence=result.sequence,
                value=result,
                provenance="machine_observed",
                freshness="historical" if historical else "fresh",
                age_seconds=max(0, age),
                warnings=list(dict.fromkeys(warnings)),
            )
            state["observations"].append(observation.model_dump(mode="json"))
            self._prune_machine_observations(state)
            health = runtime["latest"].get("source_health")
            after_health = health is None or result.captured_at > timestamp(health["measured_at"])
            after_source = source["last_measured_at"] is None or result.captured_at > timestamp(
                source["last_measured_at"]
            )
            if not historical and after_health and after_source:
                source["availability"] = (
                    "available" if result.status == "observed" else "unavailable"
                )
                source["reason"] = None if result.status == "observed" else "inference_unavailable"
                source["last_measured_at"] = result.captured_at.isoformat()
                source["boot_id"] = result.boot_id
            elif stale and after_health and after_source:
                source["availability"] = "unavailable"
                source["reason"] = "media_expired_before_publication"
                source["last_measured_at"] = result.captured_at.isoformat()
            source["last_received_at"] = now.isoformat()
            if not historical and result.status == "observed" and result.evidence_refs:
                self._apply_detector_policy(state, result, now)
            event_kind = "visual_observed" if result.kind == "frame" else "transcript_observed"
            self._append_event(connection, state, event_kind, now)
            connection.execute(
                "INSERT INTO live_media_keys VALUES (?, ?, ?, ?, ?, ?)",
                (
                    result.source_id,
                    result.boot_id,
                    result.sequence,
                    result.kind,
                    result.media_id,
                    state["revision"],
                ),
            )
            connection.execute(
                "DELETE FROM live_media_keys WHERE rowid IN (SELECT rowid FROM live_media_keys "
                "ORDER BY rowid DESC LIMIT -1 OFFSET ?)",
                (self.settings.live_media_dedupe_entries,),
            )
            return state["revision"], True

    def _apply_detector_policy(self, state: dict, result: MediaResult, now: datetime) -> None:
        # Generic COCO labels do not establish a validated firearm capability.
        # Neither ASR text nor Gemma output is an input to this deterministic policy.
        if result.kind != "frame":
            return
        supported = set(self.settings.live_evaluated_weapon_labels)
        labels = sorted(
            {detection.label for detection in result.detections if detection.label in supported}
        )
        for label in labels:
            claim = f"Possible {label}-like object in camera view; human review required"
            previous = next(
                (
                    alert
                    for alert in reversed(state["alerts"])
                    if alert["source_id"] == result.source_id
                    and alert["claim"] == claim
                    and alert["kind"] == "possible_visible_weapon"
                    and alert["disposition"] == "open"
                    and alert["evidence_status"] != "human_rejected"
                    and 0
                    <= (result.captured_at - timestamp(alert["observed_at"])).total_seconds()
                    <= self.settings.live_alert_dedupe_seconds
                ),
                None,
            )
            if previous is not None:
                previous["observed_at"] = result.captured_at.isoformat()
                previous["evidence_refs"] = list(
                    dict.fromkeys(previous["evidence_refs"] + result.evidence_refs)
                )[-8:]
                previous["freshness"] = "fresh"
            else:
                self._make_alert_space(state)
                alert = AlertEvent(
                    alert_id="alert-" + str(uuid.uuid4()),
                    kind="possible_visible_weapon",
                    claim=claim,
                    source_id=result.source_id,
                    subject_id=None,
                    observed_at=result.captured_at,
                    created_at=now,
                    evidence_refs=result.evidence_refs,
                    priority="urgent_review",
                    evidence_status="machine_observed",
                    attention="unacknowledged",
                    disposition="open",
                    freshness="fresh",
                    created_by=None,
                )
                state["alerts"].append(alert.model_dump(mode="json"))
            for report in state["scene_reports"]:
                if report["status"] == "reported_clear" and report["revoked_by"] is None:
                    report["reassessment_required"] = True
                    report["effective"] = False

    def publish_context(self, summary: ContextSummary, *, now: datetime | None = None) -> bool:
        """Advisory-only descriptive output: exact revision and current evidence required."""
        if not self.settings.live_context_enabled:
            return False
        if (summary.incident_id, summary.source_id) in self.publication_failures:
            return False
        now = now or datetime.now(UTC)
        with self._transaction() as connection:
            state = self._load(connection, summary.incident_id)
            self._machine_source(state, summary.source_id, "camera")
            if summary.snapshot_revision != state["revision"]:
                return False
            if abs((now - summary.generated_at).total_seconds()) > 10:
                return False
            references = set(summary.evidence_refs)
            matching = [
                item
                for item in state["observations"]
                if item["kind"] == "visual"
                and item["source_id"] == summary.source_id
                and item["freshness"] == "fresh"
                and item["value"]["status"] == "observed"
                and "monitoring_gap" not in item["warnings"]
                and 0
                <= (now - timestamp(item["measured_at"])).total_seconds()
                <= min(self._freshness_limit("visual"), self.settings.live_evidence_ttl_seconds)
            ]
            allowed = {
                reference for item in matching for reference in item["value"]["evidence_refs"]
            }
            if not references <= allowed or not matching:
                return False
            # Source health events advance the revision; never wrap an interrupted view
            # in fresh-looking model prose even if a caller fabricates that new revision.
            source = next(
                item for item in state["sources"] if item["source_id"] == summary.source_id
            )
            if source["availability"] != "available":
                return False
            referenced = [
                item for item in matching if references.intersection(item["value"]["evidence_refs"])
            ]
            basis = min(referenced, key=lambda item: timestamp(item["measured_at"]))
            self._retire_observations(state, summary.source_id, "context")
            state["observations"].append(
                Observation(
                    observation_id=summary.context_id,
                    source_id=summary.source_id,
                    subject_id=None,
                    kind="context",
                    measured_at=timestamp(basis["measured_at"]),
                    received_at=now,
                    boot_id=basis["boot_id"],
                    sequence=basis["sequence"],
                    value=summary,
                    provenance="unverified_model_context",
                    freshness="fresh",
                    age_seconds=max(0, (now - timestamp(basis["measured_at"])).total_seconds()),
                    warnings=["model_context_is_unverified_and_cannot_authorize_actions"],
                ).model_dump(mode="json")
            )
            self._prune_machine_observations(state)
            self._append_event(connection, state, "context_updated", now)
            return True

    def _make_alert_space(self, state: dict) -> None:
        if len(state["alerts"]) < self.settings.live_max_alerts_per_incident:
            return
        resolved = next(
            (
                index
                for index, alert in enumerate(state["alerts"])
                if alert["disposition"] == "human_resolved"
            ),
            None,
        )
        if resolved is None:
            raise LiveError(503, "unresolved_alert_capacity_reached")
        del state["alerts"][resolved]

    def _prune_observations(self, state: dict) -> None:
        while len(state["observations"]) > self.settings.live_max_observations_per_incident:
            historical = next(
                (
                    index
                    for index, observation in enumerate(state["observations"])
                    if observation["freshness"] == "historical"
                ),
                None,
            )
            if historical is None:
                raise LiveError(503, "observation_capacity_reached")
            del state["observations"][historical]

    def events_after(self, incident_id: str, after: int) -> tuple[list[IncidentEvent], bool, int]:
        """Return retained committed events, gap flag and current revision atomically."""
        try:
            with self.lock:
                state = self._load(self.connection, incident_id)
                oldest = self.connection.execute(
                    "SELECT MIN(revision) FROM live_events WHERE incident_id=?", (incident_id,)
                ).fetchone()[0]
                gap = after > state["revision"] or (oldest is not None and after < oldest - 1)
                rows = (
                    self.connection.execute(
                        "SELECT event FROM live_events WHERE incident_id=? AND revision>? "
                        "ORDER BY revision LIMIT 100",
                        (incident_id, after),
                    ).fetchall()
                    if not gap
                    else []
                )
                return (
                    [IncidentEvent.model_validate_json(row["event"]) for row in rows],
                    gap,
                    state["revision"],
                )
        except sqlite3.Error:
            raise LiveError(503, "live_store_unavailable") from None
