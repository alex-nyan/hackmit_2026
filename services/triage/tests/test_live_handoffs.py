from datetime import timedelta

import pytest
from pydantic import TypeAdapter, ValidationError
from test_live_machine_store import machine_settings, media
from test_live_store import NOW, command, live_settings, telemetry

from triage.config import Settings
from triage.live_schemas import IncidentCommand, LivePrincipal, PatientEnrollment
from triage.live_store import LiveError, LiveStore


def patient_settings(tmp_path, **updates):
    settings = live_settings(tmp_path, **updates)
    values = settings.model_dump()
    values["live_patients"] = [
        {"patient_id": "patient-p", "incident_id": "incident-a", "display_name": "Patient P"},
        {"patient_id": "patient-q", "incident_id": "incident-a", "display_name": "Patient Q"},
        {"patient_id": "patient-b", "incident_id": "incident-b", "display_name": "Patient B"},
    ]
    values["live_principals"][2]["patient_ids"] = ["patient-p"]
    values["live_principals"].extend(
        [
            {
                "principal_id": "dispatch-a",
                "token": "dispatch-" + "d" * 32,
                "role": "dispatch",
                "incident_ids": ["incident-a"],
            },
            {
                "principal_id": "hospital-q",
                "token": "hospital-" + "q" * 32,
                "role": "hospital",
                "incident_ids": ["incident-a"],
                "patient_ids": ["patient-q"],
            },
        ]
    )
    return Settings.model_validate(values)


def handoff(revision=0, patient_id="patient-p", **fields):
    return command(
        "submit_handoff",
        expected_revision=revision,
        patient_id=patient_id,
        mechanism="Fall reported by patient",
        **fields,
    )


def test_human_handoff_unknowns_attribution_no_watch_autofill_and_patient_projection(tmp_path):
    settings = patient_settings(tmp_path)
    store = LiveStore(settings)
    source, officer, hospital, dispatch, other_hospital = settings.live_principals
    try:
        store.ingest(source, telemetry(source="watch-p"), now=NOW)
        receipt, replayed = store.command(dispatch, "incident-a", "handoff-p", handoff(1), now=NOW)
        assert not replayed and receipt.handoff_id
        state = store.snapshot("incident-a", hospital, now=NOW)
        assert [patient.patient_id for patient in state.patients] == ["patient-p"]
        record = state.handoffs[0]
        assert record.patient_id == "patient-p" and record.handoff_revision == 1
        assert record.mechanism == "Fall reported by patient"
        assert record.injuries is None and record.signs is None and record.treatments is None
        assert record.recorded_by.principal_id == "dispatch-a" and record.recorded_by.at == NOW
        assert record.provenance == "human_reported"
        assert record.delivery_status == "recorded_locally_not_transmitted"
        assert store.snapshot("incident-a", officer).patients == []
        assert store.snapshot("incident-a", officer).handoffs == []
        assert store.snapshot("incident-a", officer).observations == []
        assert store.snapshot("incident-a", source).handoffs == []
        assert store.snapshot("incident-a", other_hospital).handoffs == []
        assert {
            patient.patient_id for patient in store.snapshot("incident-a", dispatch).patients
        } == {"patient-p", "patient-q"}
    finally:
        store.close()


def test_handoff_capabilities_patient_scope_and_cross_incident_denial(tmp_path):
    settings = patient_settings(tmp_path)
    store = LiveStore(settings)
    source, officer, hospital, dispatch, _ = settings.live_principals
    try:
        for principal in (source, officer):
            with pytest.raises(LiveError, match="command_forbidden"):
                store.command(principal, "incident-a", "bad-role", handoff(), now=NOW)
        for patient_id in ("patient-q", "patient-b", "not-enrolled"):
            with pytest.raises(LiveError, match="patient_forbidden"):
                store.command(
                    hospital,
                    "incident-a",
                    f"bad-{patient_id}",
                    handoff(patient_id=patient_id),
                    now=NOW,
                )
        with pytest.raises(LiveError, match="incident_forbidden"):
            store.command(
                dispatch, "incident-b", "cross-incident", handoff(patient_id="patient-b"), now=NOW
            )
        hospital_without_patient = hospital.model_copy(update={"patient_ids": []})
        assert store.snapshot("incident-a", hospital_without_patient).patients == []
        assert "watch-p" not in {
            item.source_id
            for item in store.snapshot("incident-a", hospital_without_patient).sources
        }
        assert store.snapshot("incident-a").revision == 0
    finally:
        store.close()


def test_handoff_idempotency_revision_conflict_restart_and_revoked_scope(tmp_path):
    settings = patient_settings(tmp_path)
    hospital = settings.live_principals[2]
    store = LiveStore(settings)
    first, _ = store.command(hospital, "incident-a", "stable-key", handoff(), now=NOW)
    second, _ = store.command(
        hospital,
        "incident-a",
        "revision-2",
        handoff(1, signs="Reported pain at the left wrist"),
        now=NOW,
    )
    assert second.revision == 2
    assert store.command(hospital, "incident-a", "stable-key", handoff(), now=NOW) == (first, True)
    with pytest.raises(LiveError, match="revision_conflict"):
        store.command(hospital, "incident-a", "old-context", handoff(), now=NOW)
    with pytest.raises(LiveError, match="idempotency_conflict"):
        store.command(
            hospital, "incident-a", "stable-key", handoff(signs="Changed report"), now=NOW
        )
    revoked = hospital.model_copy(update={"patient_ids": []})
    with pytest.raises(LiveError, match="patient_forbidden"):
        store.command(revoked, "incident-a", "stable-key", handoff(), now=NOW)
    store.close()
    restored = LiveStore(settings)
    try:
        assert restored.command(hospital, "incident-a", "stable-key", handoff(), now=NOW) == (
            first,
            True,
        )
        history = restored.snapshot("incident-a", hospital).handoffs
        assert [item.handoff_revision for item in history] == [1, 2]
        assert history[0].signs is None and history[1].signs == "Reported pain at the left wrist"
    finally:
        restored.close()


def test_handoff_history_bounded_and_patient_binding_immutable(tmp_path):
    settings = patient_settings(tmp_path, live_handoffs_per_patient=2)
    dispatch = settings.live_principals[3]
    store = LiveStore(settings)
    for revision in range(5):
        store.command(
            dispatch,
            "incident-a",
            f"revision-{revision}",
            handoff(revision, signs=f"Human report {revision}"),
            now=NOW,
        )
    snapshot = store.snapshot("incident-a", dispatch)
    assert [item.handoff_revision for item in snapshot.handoffs] == [4, 5]
    store.close()
    changed = settings.model_copy(
        update={
            "live_patients": [
                PatientEnrollment(
                    patient_id="patient-p", incident_id="incident-b", display_name="Other"
                )
            ]
        }
    )
    with pytest.raises(LiveError, match="patient_enrollment_changed_requires_new_id"):
        LiveStore(changed)


def test_handoff_does_not_accept_empty_forged_or_model_written_fields():
    adapter = TypeAdapter(IncidentCommand)
    for fields in (
        {},
        {"signs": " "},
        {"signs": "x" * 1001},
        {"signs": "reported", "recorded_by": {"principal_id": "forged"}},
        {"signs": "reported", "provenance": "machine_observed"},
    ):
        with pytest.raises(ValidationError):
            adapter.validate_python(
                {
                    "kind": "submit_handoff",
                    "expected_revision": 0,
                    "patient_id": "patient-p",
                    **fields,
                }
            )


def test_patient_enrollment_and_principal_scope_validation(tmp_path):
    settings = patient_settings(tmp_path)
    invalid = settings.model_dump()
    invalid["live_patients"] = [
        item for item in invalid["live_patients"] if item["patient_id"] != "patient-p"
    ]
    with pytest.raises(ValidationError, match="Watch wearer"):
        Settings.model_validate(invalid)
    with pytest.raises(ValidationError, match="unknown patient"):
        Settings.model_validate(
            {
                **settings.model_dump(),
                "live_principals": [
                    LivePrincipal(
                        principal_id="hospital-x",
                        token="h" * 32,
                        role="hospital",
                        incident_ids=["incident-a"],
                        patient_ids=["missing"],
                    ).model_dump()
                ],
            }
        )


def test_snapshot_exposes_expiry_from_measurement_and_earliest_inference(tmp_path):
    settings = machine_settings(tmp_path, live_evaluated_weapon_labels=["knife"])
    store = LiveStore(settings)
    source = settings.live_principals[0]
    try:
        store.publish_media(media(), now=NOW)
        store.ingest(source, telemetry(), now=NOW)
        store.ingest(
            source,
            telemetry(
                10,
                source="camera-a",
                now=NOW + timedelta(seconds=1),
                kind="source_health",
                value={"availability": "available"},
            ),
            now=NOW + timedelta(seconds=1),
        )
        snapshot = store.snapshot("incident-a", now=NOW + timedelta(seconds=1))
        visual = next(item for item in snapshot.observations if item.kind == "visual")
        watch = next(item for item in snapshot.observations if item.kind == "heart_rate")
        assert visual.freshness_expires_at == NOW + timedelta(seconds=3)
        assert snapshot.alerts[0].freshness_expires_at == NOW + timedelta(seconds=3)
        assert watch.freshness_expires_at == NOW + timedelta(seconds=30)
        assert snapshot.sources[3].freshness_expires_at == NOW + timedelta(seconds=3)
        store.ingest(
            source,
            telemetry(
                11,
                source="camera-a",
                now=NOW + timedelta(seconds=2),
                kind="source_health",
                value={"availability": "unavailable", "reason": "locked"},
            ),
            now=NOW + timedelta(seconds=2),
        )
        assert (
            store.snapshot("incident-a", now=NOW + timedelta(seconds=2))
            .sources[3]
            .freshness_expires_at
            is None
        )
    finally:
        store.close()
    restored = LiveStore(settings)
    try:
        snapshot = restored.snapshot("incident-a", now=NOW + timedelta(seconds=2))
        assert snapshot.sources[3].freshness_expires_at is None
        assert (
            next(
                item for item in snapshot.observations if item.kind == "visual"
            ).freshness_expires_at
            is None
        )
        assert (
            next(item for item in snapshot.observations if item.kind == "visual").freshness
            == "stale"
        )
    finally:
        restored.close()


async def test_handoff_http_route_uses_operator_and_patient_authorization(tmp_path):
    import httpx
    from test_live_api import IdlePipeline, headers

    from triage.app import create_app

    settings = patient_settings(tmp_path)
    app = create_app(settings, pipeline=IdlePipeline())
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            body = handoff().model_dump(mode="json")
            denied = await client.post(
                "/v2/incidents/incident-a/commands", json=body, headers=headers()
            )
            assert denied.status_code == 403
            hospital = settings.live_principals[2].token.get_secret_value()
            accepted = await client.post(
                "/v2/incidents/incident-a/commands", json=body, headers=headers(hospital)
            )
            assert accepted.status_code == 200 and accepted.json()["handoff_id"]
            view = await client.get("/v2/incidents/incident-a/state", headers=headers(hospital))
            record = view.json()["handoffs"][0]
            assert record["recorded_by"]["principal_id"] == "hospital-a"
            assert record["signs"] is None
            other = settings.live_principals[4].token.get_secret_value()
            other_view = await client.get("/v2/incidents/incident-a/state", headers=headers(other))
            assert other_view.json()["handoffs"] == []


def test_restart_keeps_unresolved_advisory_stale_until_new_visual_evidence(tmp_path):
    settings = machine_settings(tmp_path, live_evaluated_weapon_labels=["knife"])
    store = LiveStore(settings)
    store.publish_media(media(), now=NOW)
    store.close()
    restored = LiveStore(settings)
    try:
        restored_alert = restored.snapshot("incident-a", now=NOW).alerts[0]
        assert restored_alert.disposition == "open" and restored_alert.freshness == "stale"
        assert restored_alert.freshness_expires_at is None
        restored.publish_media(
            media(2, captured_at=NOW + timedelta(seconds=1)), now=NOW + timedelta(seconds=1)
        )
        fresh = restored.snapshot("incident-a", now=NOW + timedelta(seconds=1)).alerts[0]
        assert fresh.freshness == "fresh"
        assert fresh.freshness_expires_at == NOW + timedelta(seconds=4)
    finally:
        restored.close()


def test_empty_patient_roster_never_relaxes_retained_biometric_authorization(tmp_path):
    settings = patient_settings(tmp_path)
    store = LiveStore(settings)
    store.ingest(settings.live_principals[0], telemetry(source="watch-p"), now=NOW)
    store.close()
    invalid = settings.model_dump()
    invalid["live_patients"] = []
    for principal in invalid["live_principals"]:
        principal["patient_ids"] = []
    with pytest.raises(ValidationError, match="patient Watch wearer"):
        Settings.model_validate(invalid)
    # Defensive projection stays closed even if internal code bypasses Settings validation.
    bypassed = settings.model_copy(
        update={
            "live_patients": [],
            "live_principals": [
                principal.model_copy(update={"patient_ids": []})
                for principal in settings.live_principals
            ],
        }
    )
    reopened = LiveStore(bypassed)
    try:
        for principal in bypassed.live_principals[1:]:
            projected = reopened.snapshot("incident-a", principal, now=NOW)
            assert "watch-p" not in {source.source_id for source in projected.sources}
            assert projected.observations == []
    finally:
        reopened.close()


def test_dispatch_patient_allowlist_applies_to_biometrics_and_handoffs_equally(tmp_path):
    settings = patient_settings(tmp_path)
    store = LiveStore(settings)
    source, _, _, dispatch, _ = settings.live_principals
    try:
        store.ingest(source, telemetry(source="watch-p"), now=NOW)
        restricted = dispatch.model_copy(update={"patient_ids": ["patient-q"]})
        projected = store.snapshot("incident-a", restricted, now=NOW)
        assert [patient.patient_id for patient in projected.patients] == ["patient-q"]
        assert projected.observations == []
        assert "watch-p" not in {item.source_id for item in projected.sources}
        unrestricted = store.snapshot("incident-a", dispatch, now=NOW)
        assert unrestricted.observations[0].subject_id == "patient-p"
    finally:
        store.close()


@pytest.mark.parametrize("revoked_scope", ["source_ids", "patient_ids"])
def test_cached_assistance_and_alert_commands_recheck_current_grants(tmp_path, revoked_scope):
    settings = patient_settings(tmp_path)
    store = LiveStore(settings)
    hospital = settings.live_principals[2]
    help_command = command("assistance", source_id="watch-p", note="Assistance requested")
    try:
        created, _ = store.command(hospital, "incident-a", "help", help_command, now=NOW)
        ack = command("acknowledge", expected_revision=created.revision, alert_id=created.alert_id)
        acknowledged, _ = store.command(hospital, "incident-a", "ack", ack, now=NOW)
        assert store.command(hospital, "incident-a", "help", help_command, now=NOW) == (
            created,
            True,
        )
        assert store.command(hospital, "incident-a", "ack", ack, now=NOW) == (acknowledged, True)
        revoked = hospital.model_copy(update={revoked_scope: []})
        for key, payload in (("help", help_command), ("ack", ack)):
            with pytest.raises(LiveError, match="source_forbidden"):
                store.command(revoked, "incident-a", key, payload, now=NOW)
        assert store.snapshot("incident-a").revision == acknowledged.revision
    finally:
        store.close()


def test_cached_alert_command_for_pruned_target_fails_without_mutation(tmp_path):
    settings = patient_settings(tmp_path, live_max_alerts_per_incident=10)
    store = LiveStore(settings)
    hospital, dispatch = settings.live_principals[2:4]
    try:
        created, _ = store.command(
            hospital,
            "incident-a",
            "help",
            command("assistance", source_id="watch-p", note="Assistance"),
            now=NOW,
        )
        ack = command("acknowledge", expected_revision=1, alert_id=created.alert_id)
        store.command(hospital, "incident-a", "ack", ack, now=NOW)
        store.command(
            dispatch,
            "incident-a",
            "resolve",
            command(
                "resolve",
                expected_revision=2,
                alert_id=created.alert_id,
                note="Resolved by operator",
            ),
            now=NOW,
        )
        for index in range(10):
            store.command(
                dispatch,
                "incident-a",
                f"new-{index}",
                command("assistance", note="Separate request"),
                now=NOW,
            )
        with pytest.raises(LiveError, match="alert_not_found"):
            store.command(hospital, "incident-a", "ack", ack, now=NOW)
        assert store.snapshot("incident-a").revision == 13
    finally:
        store.close()
