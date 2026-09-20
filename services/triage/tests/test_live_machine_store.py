from datetime import timedelta

import pytest
from pydantic import ValidationError
from test_live_store import NOW, command, live_settings, telemetry

from triage.config import Settings
from triage.live_media_schemas import ContextSummary, MediaResult
from triage.live_store import LiveError, LiveStore
from triage.schemas import ModelProvenance


def machine_settings(tmp_path, **updates):
    return live_settings(tmp_path, live_media_enabled=True, live_context_enabled=True, **updates)


def media(sequence=1, *, captured_at=NOW, **updates):
    return MediaResult.model_validate(
        {
            "media_id": f"media-{sequence}",
            "incident_id": "incident-a",
            "source_id": "camera-a",
            "kind": "frame",
            "boot_id": "camera-boot",
            "sequence": sequence,
            "captured_at": captured_at,
            "processed_at": NOW,
            "status": "observed",
            "evidence_refs": [f"ev-{sequence}"],
            "detections": [
                {
                    "label": "knife",
                    "confidence": 0.7,
                    "bbox": {"x1": 0.1, "y1": 0.1, "x2": 0.5, "y2": 0.5},
                }
            ],
            "transcript": None,
            "models": [{"provider": "ultralytics", "model": "yolo26n"}],
            "warnings": [],
            "timings_ms": {"processing": 10},
            **updates,
        }
    )


def context(revision, **updates):
    return ContextSummary(
        context_id="ctx-1",
        incident_id="incident-a",
        source_id="camera-a",
        snapshot_revision=revision,
        generated_at=NOW,
        evidence_refs=["ev-1"],
        summary="Possible object in the camera view",
        limitations=["Unverified model description"],
        model=ModelProvenance(provider="ollama", model="local-gemma"),
        **updates,
    )


@pytest.fixture
def store(tmp_path):
    value = LiveStore(machine_settings(tmp_path))
    yield value
    value.close()


def test_generic_detections_are_observations_without_default_alerts(store):
    revision = store.publish_media(media(), now=NOW)
    snapshot = store.snapshot("incident-a", now=NOW)
    assert revision == 1 and snapshot.alerts == []
    observed = snapshot.observations[0]
    assert observed.kind == "visual" and observed.subject_id is None
    assert observed.provenance == "machine_observed"
    assert observed.value.detections[0].bbox.x1 == 0.1
    assert observed.value.confidence_semantics == "uncalibrated_model_scores"
    assert snapshot.sources[3].availability == "available"
    assert store.snapshot("incident-a", store.settings.live_principals[2]).observations == []


def test_evaluated_label_dedup_and_rejection_never_suppresses_new_evidence(tmp_path):
    settings = machine_settings(tmp_path, live_evaluated_weapon_labels=["knife"])
    store = LiveStore(settings)
    officer = settings.live_principals[1]
    try:
        store.publish_media(media(), now=NOW)
        first = store.snapshot("incident-a", now=NOW).alerts[0]
        store.command(
            officer,
            "incident-a",
            "ack",
            command("acknowledge", expected_revision=1, alert_id=first.alert_id),
            now=NOW,
        )
        store.publish_media(media(2, captured_at=NOW + timedelta(seconds=1)), now=NOW)
        updated = store.snapshot("incident-a", now=NOW)
        assert len(updated.alerts) == 1
        assert updated.alerts[0].attention == "acknowledged"
        assert updated.alerts[0].disposition == "open"
        assert updated.alerts[0].evidence_refs == ["ev-1", "ev-2"]
        store.command(
            officer,
            "incident-a",
            "reject",
            command(
                "reject",
                expected_revision=3,
                alert_id=first.alert_id,
                note="Tool in initial evidence",
            ),
            now=NOW,
        )
        store.publish_media(media(3, captured_at=NOW + timedelta(seconds=2)), now=NOW)
        alerts = store.snapshot("incident-a", now=NOW).alerts
        assert len(alerts) == 2 and alerts[1].alert_id != first.alert_id
        assert alerts[1].evidence_status == "machine_observed"
        assert alerts[1].created_by is None and alerts[1].subject_id is None
    finally:
        store.close()


def test_detectors_reassess_human_clear_reports_but_never_clear_scene(tmp_path):
    settings = machine_settings(tmp_path, live_evaluated_weapon_labels=["knife"])
    store = LiveStore(settings)
    try:
        officer = settings.live_principals[1]
        store.command(
            officer,
            "incident-a",
            "scene",
            command(
                "scene_report",
                expected_revision=0,
                status="reported_clear",
                scope="Entrance",
                note="Officer inspected entrance",
                valid_for_seconds=60,
            ),
            now=NOW,
        )
        store.publish_media(media(), now=NOW)
        report = store.snapshot("incident-a", now=NOW).scene_reports[0]
        assert not report.effective and report.reassessment_required
        store.publish_media(
            media(2, captured_at=NOW + timedelta(seconds=1), detections=[]), now=NOW
        )
        assert store.snapshot("incident-a", now=NOW).alerts[0].disposition == "open"
        assert not store.snapshot("incident-a", now=NOW).scene_reports[0].effective
    finally:
        store.close()


def test_inflight_result_cannot_revive_locked_phone_coverage(store):
    device = store.settings.live_principals[0]
    stopped = telemetry(
        20,
        source="camera-a",
        now=NOW + timedelta(seconds=1),
        kind="source_health",
        value={"availability": "unavailable", "reason": "phone_locked"},
    )
    store.ingest(device, stopped, now=NOW + timedelta(seconds=1))
    store.publish_media(media(), now=NOW + timedelta(seconds=1))
    snapshot = store.snapshot("incident-a", now=NOW + timedelta(seconds=1))
    assert snapshot.sources[3].availability == "unavailable"
    assert snapshot.sources[3].reason == "phone_locked"
    assert snapshot.sources[3].last_measured_at == NOW + timedelta(seconds=1)
    assert not store.publish_context(context(snapshot.revision), now=NOW + timedelta(seconds=1))
    # A genuinely newer frame is evidence that capture has resumed.
    store.publish_media(
        media(2, captured_at=NOW + timedelta(seconds=2)), now=NOW + timedelta(seconds=2)
    )
    assert (
        store.snapshot("incident-a", now=NOW + timedelta(seconds=2)).sources[3].availability
        == "available"
    )


def test_expired_and_unavailable_results_do_not_raise_fresh_advisories(tmp_path):
    store = LiveStore(machine_settings(tmp_path, live_evaluated_weapon_labels=["knife"]))
    try:
        store.publish_media(media(captured_at=NOW - timedelta(seconds=4)), now=NOW)
        snapshot = store.snapshot("incident-a", now=NOW)
        assert snapshot.alerts == [] and snapshot.observations[0].freshness == "historical"
        assert snapshot.sources[3].availability == "unavailable"
        store.publish_media(
            media(
                2,
                status="unavailable",
                detections=[],
                evidence_refs=[],
                warnings=["native_worker_timeout"],
            ),
            now=NOW,
        )
        snapshot = store.snapshot("incident-a", now=NOW)
        assert snapshot.sources[3].reason == "inference_unavailable"
        assert snapshot.alerts == []
        assert "inference_coverage_unavailable" in snapshot.observations[-1].warnings
    finally:
        store.close()


def test_media_deduplication_survives_restart_and_preserves_historical_timestamps(tmp_path):
    settings = machine_settings(tmp_path)
    store = LiveStore(settings)
    initial = store.publish_media(media(), now=NOW)
    assert store.publish_media(media(), now=NOW) == initial
    store.close()
    restarted = LiveStore(settings)
    try:
        before = restarted.snapshot("incident-a", now=NOW)
        assert restarted.publish_media(media(), now=NOW) == initial
        after = restarted.snapshot("incident-a", now=NOW)
        assert after.revision == before.revision and len(after.observations) == 1
        assert after.observations[0].freshness == "stale"
        assert "monitoring_gap" in after.observations[0].warnings
    finally:
        restarted.close()


def test_context_exact_revision_references_freshness_and_no_action_authority(store):
    store.publish_media(media(), now=NOW)
    invalid_refs = context(1).model_copy(update={"evidence_refs": ["ev-elsewhere"]})
    assert not store.publish_context(invalid_refs, now=NOW)
    assert not store.publish_context(context(0), now=NOW)
    assert store.publish_context(context(1), now=NOW)
    snapshot = store.snapshot("incident-a", now=NOW)
    assert snapshot.alerts == [] and snapshot.scene_reports == []
    summary = next(item for item in snapshot.observations if item.kind == "context")
    assert summary.provenance == "unverified_model_context"
    assert summary.value.context_semantics == "unverified_visual_context_no_action_authority"
    store.command(
        store.settings.live_principals[1],
        "incident-a",
        "help",
        command("assistance", note="Situation changed"),
        now=NOW,
    )
    assert (
        next(
            item
            for item in store.snapshot("incident-a", now=NOW).observations
            if item.kind == "context"
        ).freshness
        == "stale"
    )
    assert not store.publish_context(context(1), now=NOW)
    # Even caller-provided up-to-date revision cannot legitimize aged evidence.
    assert not store.publish_context(context(3), now=NOW + timedelta(seconds=31))


def test_machine_source_spoofing_and_retention_cannot_displace_current(store, tmp_path):
    with pytest.raises(LiveError, match="machine_source_forbidden"):
        store.publish_media(media(source_id="watch-a"), now=NOW)
    with pytest.raises(LiveError, match="future_machine_result"):
        store.publish_media(media(captured_at=NOW + timedelta(seconds=3)), now=NOW)
    store.settings.live_media_results_per_incident = 2
    store.publish_media(media(100), now=NOW)
    for index in range(10):
        store.publish_media(media(index, captured_at=NOW - timedelta(seconds=20)), now=NOW)
    snapshot = store.snapshot("incident-a", now=NOW)
    assert len(snapshot.observations) == 2
    assert any(
        item.observation_id == "media-100" and item.freshness == "fresh"
        for item in snapshot.observations
    )


@pytest.mark.parametrize("value", ["85", True, False])
def test_measurements_reject_non_numeric_json(value):
    with pytest.raises(ValidationError):
        telemetry(value={"bpm": value})
    with pytest.raises(ValidationError):
        telemetry(
            source="gps-a",
            kind="location",
            value={"latitude": value, "longitude": -71, "horizontal_accuracy_m": 4},
        )
    with pytest.raises(ValidationError):
        telemetry(
            kind="source_health", value={"availability": "available", "battery_fraction": value}
        )


def test_numeric_json_integers_and_clock_skew_are_explicit(store):
    device = store.settings.live_principals[0]
    receipt = store.ingest(device, telemetry(now=NOW + timedelta(seconds=1)), now=NOW)
    assert receipt.results[0].status == "accepted"
    assert receipt.results[0].warnings == ["clock_ahead"]
    assert store.snapshot("incident-a", now=NOW).observations[0].value.bpm == 85.0
    with pytest.raises(ValidationError):
        Settings(api_token="v" * 32, live_media_enabled=True)


def test_visual_freshness_expires_with_camera_budget_not_watch_budget(tmp_path):
    store = LiveStore(machine_settings(tmp_path, live_evaluated_weapon_labels=["knife"]))
    try:
        store.publish_media(media(), now=NOW)
        store.ingest(store.settings.live_principals[0], telemetry(), now=NOW)
        expired = store.snapshot("incident-a", now=NOW + timedelta(seconds=4))
        assert (
            next(item for item in expired.observations if item.kind == "visual").freshness
            == "stale"
        )
        assert (
            next(item for item in expired.observations if item.kind == "heart_rate").freshness
            == "fresh"
        )
        assert expired.alerts[0].freshness == "stale"
        assert expired.alerts[0].disposition == "open"
        assert expired.sources[3].availability == "stale"
    finally:
        store.close()


def test_capture_heartbeat_cannot_restore_failed_or_absent_inference(store):
    device = store.settings.live_principals[0]
    store.ingest(
        device,
        telemetry(1, source="camera-a", kind="source_health", value={"availability": "available"}),
        now=NOW,
    )
    assert store.snapshot("incident-a", now=NOW).sources[3].reason == "awaiting_inference"
    store.publish_media(media(status="unavailable", detections=[], evidence_refs=[]), now=NOW)
    store.ingest(
        device,
        telemetry(
            2,
            source="camera-a",
            now=NOW + timedelta(seconds=1),
            kind="source_health",
            value={"availability": "available"},
        ),
        now=NOW + timedelta(seconds=1),
    )
    failed = store.snapshot("incident-a", now=NOW + timedelta(seconds=1)).sources[3]
    assert failed.availability == "unavailable" and failed.reason == "inference_unavailable"


def test_publication_failure_remains_visible_until_new_output_is_durable(store, monkeypatch):
    store.publish_media(media(), now=NOW)
    publish = store._publish_media

    def fail(*args, **kwargs):
        raise LiveError(503, "live_store_unavailable")

    monkeypatch.setattr(store, "_publish_media", fail)
    with pytest.raises(LiveError):
        store.publish_media(media(2), now=NOW)
    state = store.snapshot("incident-a", now=NOW)
    assert state.sources[3].availability == "unavailable"
    assert state.sources[3].reason == "inference_publication_unavailable"
    monkeypatch.setattr(store, "_publish_media", publish)
    store.publish_media(media(), now=NOW)
    assert store.snapshot("incident-a", now=NOW).sources[3].availability == "unavailable"
    assert not store.publish_context(context(state.revision), now=NOW)
    store.publish_media(
        media(3, captured_at=NOW + timedelta(seconds=1)), now=NOW + timedelta(seconds=1)
    )
    assert (
        store.snapshot("incident-a", now=NOW + timedelta(seconds=1)).sources[3].availability
        == "available"
    )
