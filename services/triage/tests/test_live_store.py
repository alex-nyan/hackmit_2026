from datetime import UTC, datetime, timedelta, timezone

import pytest
from pydantic import TypeAdapter, ValidationError

from triage.config import Settings
from triage.live_schemas import IncidentCommand, LivePrincipal, TelemetryRequest
from triage.live_store import LiveError, LiveStore

SOURCE_TOKEN = "source-" + "s" * 32
OFFICER_TOKEN = "officer-" + "o" * 32
HOSPITAL_TOKEN = "hospital-" + "h" * 32
NOW = datetime.now(UTC)


def live_settings(tmp_path, **updates):
    return Settings(
        api_token="v" * 32,
        database_path=tmp_path / "v1.sqlite3",
        live_enabled=True,
        live_database_path=tmp_path / "live.sqlite3",
        live_incident_ids=["incident-a", "incident-b"],
        live_sources=[
            {
                "source_id": "watch-a",
                "incident_id": "incident-a",
                "kind": "watch",
                "display_name": "Responder Watch",
                "wearer_id": "officer-a",
                "wearer_role": "responder",
            },
            {
                "source_id": "watch-p",
                "incident_id": "incident-a",
                "kind": "watch",
                "display_name": "Patient Watch",
                "wearer_id": "patient-p",
                "wearer_role": "patient",
            },
            {
                "source_id": "gps-a",
                "incident_id": "incident-a",
                "kind": "gps",
                "display_name": "Phone GPS",
            },
            {
                "source_id": "camera-a",
                "incident_id": "incident-a",
                "kind": "camera",
                "display_name": "Phone Camera",
            },
        ],
        live_principals=[
            {
                "principal_id": "phone-a",
                "token": SOURCE_TOKEN,
                "role": "source",
                "incident_ids": ["incident-a"],
                "source_ids": ["watch-a", "watch-p", "gps-a", "camera-a"],
            },
            {
                "principal_id": "officer-a",
                "token": OFFICER_TOKEN,
                "role": "officer",
                "incident_ids": ["incident-a"],
            },
            {
                "principal_id": "hospital-a",
                "token": HOSPITAL_TOKEN,
                "role": "hospital",
                "incident_ids": ["incident-a"],
                "source_ids": ["watch-a", "watch-p", "gps-a"],
            },
        ],
        **updates,
    )


def telemetry(sequence=1, *, source="watch-a", now=NOW, boot="boot-a", **updates):
    sample = {
        "sample_id": f"sample-{boot}-{sequence}",
        "boot_id": boot,
        "sequence": sequence,
        "measured_at": now.isoformat(),
        "kind": "heart_rate",
        "value": {"bpm": 85},
        **updates,
    }
    return TelemetryRequest.model_validate(
        {
            "incident_id": "incident-a",
            "source_id": source,
            "samples": [sample],
        }
    )


def command(kind, **fields):
    return TypeAdapter(IncidentCommand).validate_python({"kind": kind, **fields})


@pytest.fixture
def store(tmp_path):
    settings = live_settings(tmp_path)
    value = LiveStore(settings)
    yield value
    value.close()


def test_identity_freshness_duplicate_and_atomic_conflict(store):
    source = store.settings.live_principals[0]
    receipt = store.ingest(source, telemetry(), now=NOW)
    snapshot = store.snapshot("incident-a", now=NOW)
    assert receipt.revision == snapshot.revision == 1
    assert snapshot.observations[0].subject_id == "officer-a"
    assert snapshot.observations[0].value.signal_quality == "unknown"
    duplicate = store.ingest(source, telemetry(), now=NOW + timedelta(seconds=100))
    assert duplicate.results[0].status == "duplicate"
    assert duplicate.revision == 1
    conflict = telemetry(2, now=NOW + timedelta(seconds=1))
    conflict.samples.append(telemetry(value={"bpm": 120}).samples[0])
    with pytest.raises(LiveError, match="sample_id_conflict"):
        store.ingest(source, conflict, now=NOW + timedelta(seconds=1))
    assert store.snapshot("incident-a", now=NOW).revision == 1
    assert len(store.snapshot("incident-a", now=NOW).observations) == 1
    stale = store.snapshot("incident-a", now=NOW + timedelta(seconds=31))
    assert stale.observations[0].freshness == "stale"
    assert stale.sources[0].availability == "stale"


def test_no_forged_identity_or_clinical_fields():
    with pytest.raises(ValidationError):
        telemetry(subject_id="patient-forged")
    with pytest.raises(ValidationError):
        telemetry(value={"bpm": 80, "spo2": 98})
    with pytest.raises(ValidationError):
        telemetry(value={"bpm": float("nan")})
    with pytest.raises(ValidationError):
        telemetry(sequence=True)


@pytest.mark.parametrize(
    "offset,code", [(-11, "future_sample"), (86_401, "sample_outside_retention")]
)
def test_future_and_expired_batches_never_modify_state(store, offset, code):
    payload = telemetry(now=NOW - timedelta(seconds=offset))
    with pytest.raises(LiveError, match=code):
        store.ingest(store.settings.live_principals[0], payload, now=NOW)
    assert store.snapshot("incident-a").revision == 0


def test_out_of_order_gap_restart_and_offset_chronology(store):
    source = store.settings.live_principals[0]
    store.ingest(source, telemetry(), now=NOW)
    second = telemetry(4, now=NOW + timedelta(seconds=1))
    receipt = store.ingest(source, second, now=NOW + timedelta(seconds=1))
    assert "sequence_gap" in receipt.results[0].warnings
    older = telemetry(3, now=NOW - timedelta(seconds=1))
    assert store.ingest(source, older, now=NOW).results[0].status == "historical"
    restarted = telemetry(0, boot="boot-b", now=NOW + timedelta(seconds=2))
    assert (
        store.ingest(source, restarted, now=NOW + timedelta(seconds=2)).results[0].status
        == "accepted"
    )
    # 01:00 +01 is chronologically earlier than 00:30Z, despite lexical order.
    offset_now = NOW + timedelta(seconds=3)
    store.ingest(source, telemetry(5, now=offset_now), now=offset_now)
    health = telemetry(
        6,
        now=(offset_now - timedelta(seconds=1)).astimezone(timezone(timedelta(hours=1))),
        kind="source_health",
        value={"availability": "available"},
    )
    store.ingest(source, health, now=offset_now)
    snapshot = store.snapshot("incident-a", now=offset_now)
    assert snapshot.sources[0].last_measured_at == offset_now
    assert snapshot.sources[0].sequence_gaps == 2


def test_backfill_cannot_evict_current_readings(tmp_path):
    settings = live_settings(tmp_path, live_max_observations_per_incident=10)
    store = LiveStore(settings)
    try:
        source = settings.live_principals[0]
        current = store.ingest(source, telemetry(100), now=NOW)
        for sequence in range(20):
            store.ingest(source, telemetry(sequence, now=NOW - timedelta(minutes=1)), now=NOW)
        snapshot = store.snapshot("incident-a", now=NOW)
        assert len(snapshot.observations) == 10
        fresh = [item for item in snapshot.observations if item.freshness == "fresh"]
        assert [item.observation_id for item in fresh] == [current.results[0].observation_id]
    finally:
        store.close()


def test_source_scope_kind_incident_and_hospital_privacy(store):
    source, officer, hospital = store.settings.live_principals
    store.ingest(source, telemetry(), now=NOW)
    store.ingest(source, telemetry(source="watch-p"), now=NOW)
    with pytest.raises(LiveError, match="source_kind_mismatch"):
        store.ingest(source, telemetry(source="camera-a"), now=NOW)
    with pytest.raises(LiveError, match="source_forbidden"):
        store.ingest(officer, telemetry(), now=NOW)
    with pytest.raises(LiveError, match="incident_forbidden"):
        store.snapshot("incident-b", officer)
    projection = store.snapshot("incident-a", hospital, now=NOW)
    assert "watch-a" not in {item.source_id for item in projection.sources}
    assert {item.subject_id for item in projection.observations} == {"patient-p"}
    no_sources = hospital.model_copy(update={"source_ids": []})
    assert store.snapshot("incident-a", no_sources).sources == []
    assert store.snapshot("incident-a", no_sources).observations == []


def test_acknowledgment_rejection_resolution_and_command_replay(store):
    source, officer, hospital = store.settings.live_principals
    assistance = command(
        "assistance", note="Need assistance at north entrance", source_id="camera-a"
    )
    created, _ = store.command(source, "incident-a", "help-1", assistance, now=NOW)
    ack = command("acknowledge", expected_revision=1, alert_id=created.alert_id)
    acknowledged, _ = store.command(officer, "incident-a", "ack-1", ack, now=NOW)
    replay, replayed = store.command(officer, "incident-a", "ack-1", ack, now=NOW)
    assert replayed and acknowledged == replay
    state = store.snapshot("incident-a", officer, now=NOW)
    alert = state.alerts[0]
    assert alert.attention == "acknowledged" and alert.disposition == "open"
    assert alert.evidence_status == "human_reported"
    assert alert.acknowledged_by.principal_id == "officer-a"
    with pytest.raises(LiveError, match="revision_conflict"):
        store.command(
            officer,
            "incident-a",
            "stale",
            command(
                "resolve",
                expected_revision=1,
                alert_id=created.alert_id,
                note="Incorrect old context",
            ),
            now=NOW,
        )
    with pytest.raises(LiveError, match="command_forbidden"):
        store.command(
            hospital,
            "incident-a",
            "hospital-resolve",
            command("resolve", expected_revision=2, alert_id=created.alert_id, note="No authority"),
            now=NOW,
        )
    reject, _ = store.command(
        officer,
        "incident-a",
        "reject-1",
        command(
            "reject", expected_revision=2, alert_id=created.alert_id, note="Accidental activation"
        ),
        now=NOW,
    )
    assert store.snapshot("incident-a").alerts[0].disposition == "open"
    store.command(
        officer,
        "incident-a",
        "resolve-1",
        command(
            "resolve",
            expected_revision=reject.revision,
            alert_id=created.alert_id,
            note="Confirmed resolved",
        ),
        now=NOW,
    )
    assert store.snapshot("incident-a").alerts[0].disposition == "human_resolved"
    with pytest.raises(LiveError, match="idempotency_conflict"):
        store.command(
            source,
            "incident-a",
            "help-1",
            command("assistance", note="Different event", source_id="camera-a"),
            now=NOW,
        )


def test_scene_reports_human_only_expiry_replacement_and_reassessment(store):
    source, officer, _ = store.settings.live_principals
    clear = command(
        "scene_report",
        expected_revision=0,
        status="reported_clear",
        scope="North entrance",
        note="Officer checked entrance only",
        valid_for_seconds=60,
    )
    with pytest.raises(LiveError, match="command_forbidden"):
        store.command(source, "incident-a", "forged-clear", clear, now=NOW)
    created, _ = store.command(officer, "incident-a", "clear", clear, now=NOW)
    assert store.snapshot("incident-a", now=NOW).scene_reports[0].effective
    assert (
        not store.snapshot("incident-a", now=NOW + timedelta(seconds=61)).scene_reports[0].effective
    )
    store.command(
        officer,
        "incident-a",
        "restricted",
        command(
            "scene_report",
            expected_revision=1,
            status="restricted",
            scope="Unknown boundary",
            note="New hazard observed; reassessment needed",
            valid_for_seconds=90,
        ),
        now=NOW,
    )
    assert not store.snapshot("incident-a", now=NOW).scene_reports[0].effective
    store.command(
        officer,
        "incident-a",
        "revoke",
        command(
            "revoke_scene_report",
            expected_revision=2,
            report_id=created.report_id,
            note="Withdraw prior report",
        ),
        now=NOW,
    )
    assert (
        store.snapshot("incident-a", now=NOW).scene_reports[0].revoked_by.principal_id
        == "officer-a"
    )
    store.command(
        officer,
        "incident-a",
        "clear-again",
        command(
            "scene_report",
            expected_revision=3,
            status="reported_clear",
            scope="North entrance",
            note="Rechecked entrance",
            valid_for_seconds=60,
        ),
        now=NOW,
    )
    store.command(
        officer, "incident-a", "new-assistance", command("assistance", note="Need help"), now=NOW
    )
    assert all(
        not report.effective
        for report in store.snapshot("incident-a", now=NOW).scene_reports
        if report.status == "reported_clear"
    )


def test_restart_marks_monitoring_gap_and_preserves_idempotency(tmp_path):
    settings = live_settings(tmp_path)
    store = LiveStore(settings)
    source, officer, _ = settings.live_principals
    store.ingest(source, telemetry(), now=NOW)
    request = command("assistance", note="Need help")
    created, _ = store.command(officer, "incident-a", "help", request, now=NOW)
    store.close()
    restarted = LiveStore(settings)
    try:
        snapshot = restarted.snapshot("incident-a", now=NOW)
        assert snapshot.sources[0].availability == "unknown"
        assert snapshot.sources[0].reason == "service_restarted"
        assert snapshot.observations[0].freshness == "stale"
        assert "monitoring_gap" in snapshot.observations[0].warnings
        assert snapshot.alerts[0].disposition == "open"
        assert restarted.command(officer, "incident-a", "help", request, now=NOW) == (created, True)
        restarted.ingest(source, telemetry(2, now=NOW + timedelta(seconds=1)), now=NOW)
        assert restarted.snapshot("incident-a", now=NOW).sources[0].availability == "available"
    finally:
        restarted.close()
    changed_sources = [item.model_dump(mode="json") for item in settings.live_sources]
    changed_sources[0]["wearer_id"] = "patient-forged"
    changed_sources[0]["wearer_role"] = "patient"
    changed = settings.model_copy(
        update={
            "live_sources": [
                type(settings.live_sources[0]).model_validate(item) for item in changed_sources
            ]
        }
    )
    with pytest.raises(LiveError, match="enrollment_changed_requires_new_source_id"):
        LiveStore(changed)


def test_bounded_event_replay_and_unresolved_alert_capacity(tmp_path):
    settings = live_settings(
        tmp_path, live_max_events_per_incident=10, live_max_alerts_per_incident=10
    )
    store = LiveStore(settings)
    try:
        source, officer, _ = settings.live_principals
        for sequence in range(15):
            store.ingest(
                source, telemetry(sequence, now=NOW + timedelta(milliseconds=sequence)), now=NOW
            )
        assert store.events_after("incident-a", 0)[1] is True
        assert store.events_after("incident-a", 5)[1] is False
        events, _, revision = store.events_after("incident-a", 5)
        assert [event.revision for event in events] == list(range(6, 16))
        assert revision == 15
        assert store.events_after("incident-a", 16)[1]
        for index in range(10):
            store.command(
                officer,
                "incident-a",
                f"help-{index}",
                command("assistance", note="Assistance required"),
                now=NOW,
            )
        with pytest.raises(LiveError, match="unresolved_alert_capacity_reached"):
            store.command(
                officer,
                "incident-a",
                "over-capacity",
                command("assistance", note="Assistance required"),
                now=NOW,
            )
        assert len(store.snapshot("incident-a").alerts) == 10
    finally:
        store.close()


def test_removed_source_cannot_receive_new_commands(tmp_path):
    settings = live_settings(tmp_path)
    store = LiveStore(settings)
    store.close()
    settings.live_sources = []
    settings.live_principals = [settings.live_principals[1]]
    store = LiveStore(settings)
    try:
        with pytest.raises(LiveError, match="source_forbidden"):
            store.command(
                settings.live_principals[0],
                "incident-a",
                "removed",
                command("assistance", source_id="watch-a", note="Removed"),
                now=NOW,
            )
    finally:
        store.close()


def test_configuration_requires_explicit_scopes_and_unique_credentials(tmp_path):
    with pytest.raises(ValidationError, match="explicit incidents and principals"):
        Settings(api_token="a" * 32, live_enabled=True)
    settings = live_settings(tmp_path)
    config = settings.model_dump()
    config["live_principals"][1]["token"] = SOURCE_TOKEN
    with pytest.raises(ValidationError, match="unique"):
        Settings.model_validate(config)
    with pytest.raises(ValidationError):
        LivePrincipal(
            principal_id="bad", token="s" * 32, role="source", incident_ids=["incident-a"]
        )
