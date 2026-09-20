import asyncio
from contextlib import asynccontextmanager

import httpx
import pytest
from test_live_store import (
    HOSPITAL_TOKEN,
    NOW,
    OFFICER_TOKEN,
    SOURCE_TOKEN,
    command,
    live_settings,
    telemetry,
)

from triage.app import create_app
from triage.live_api import LiveAPI
from triage.live_store import LiveStore


class IdlePipeline:
    async def close(self):
        pass

    async def ready(self):
        return {"vision": True}


def headers(token=OFFICER_TOKEN, key="test-key"):
    return {"Authorization": f"Bearer {token}", "Idempotency-Key": key}


@asynccontextmanager
async def service(tmp_path, **options):
    settings = live_settings(tmp_path, **options)
    app = create_app(settings, pipeline=IdlePipeline())
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            yield client, app


async def test_v2_disabled_without_explicit_configuration(tmp_path):
    settings = live_settings(tmp_path)
    settings.live_enabled = False
    app = create_app(settings, pipeline=IdlePipeline())
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            response = await client.get("/v2/session", headers=headers())
            assert response.status_code == 404
            assert response.json()["error"]["code"] == "live_disabled"
            assert not settings.live_database_path.exists()


async def test_auth_before_body_and_separate_v1_credentials(tmp_path):
    async def forbidden_body():
        raise AssertionError("Unauthorized requests must not be read")
        yield b""

    async with service(tmp_path) as (client, _):
        unauth = await client.post("/v2/ingest/telemetry", content=forbidden_body())
        assert unauth.status_code == 401
        old_token = await client.get("/v2/session", headers=headers("v" * 32))
        assert old_token.status_code == 401
        session = await client.get("/v2/session", headers=headers())
        assert session.json() == {
            "principal_id": "officer-a",
            "role": "officer",
            "incident_ids": ["incident-a"],
            "source_ids": [],
        }
        assert OFFICER_TOKEN not in session.text
        assert (
            await client.get("/v2/incidents/incident-b/state", headers=headers())
        ).status_code == 403
        assert (
            await client.get("/v2/incidents/incident-a/state", headers=headers(SOURCE_TOKEN))
        ).status_code == 403


async def test_bounds_input_validation_and_role_permissions(tmp_path):
    async with service(tmp_path, live_max_request_bytes=1024) as (client, _):
        oversized = await client.post(
            "/v2/ingest/telemetry",
            content="x" * 1025,
            headers={**headers(SOURCE_TOKEN), "Content-Type": "application/json"},
        )
        assert oversized.status_code == 413
        invalid = await client.post(
            "/v2/ingest/telemetry", json={"private": "DO_NOT_ECHO"}, headers=headers(SOURCE_TOKEN)
        )
        assert invalid.status_code == 422 and "DO_NOT_ECHO" not in invalid.text
        operator = await client.post("/v2/ingest/telemetry", json={}, headers=headers())
        assert operator.status_code == 403
        no_actor = await client.post(
            "/v2/incidents/incident-a/commands",
            json={"kind": "assistance", "note": "Need assistance", "principal_id": "forged"},
            headers=headers(),
        )
        assert no_actor.status_code == 422
        forbidden = await client.post(
            "/v2/incidents/incident-a/commands",
            json={
                "kind": "scene_report",
                "expected_revision": 0,
                "status": "reported_clear",
                "scope": "Entry",
                "note": "No scene authority",
                "valid_for_seconds": 30,
            },
            headers=headers(HOSPITAL_TOKEN),
        )
        assert forbidden.status_code == 403


async def test_shared_state_command_idempotency_and_independent_model_admission(tmp_path):
    async with service(tmp_path) as (client, app):
        app.state.admission.acquire()  # Simulates a hung legacy model request.
        ingested = await client.post(
            "/v2/ingest/telemetry",
            json=telemetry(now=NOW).model_dump(mode="json"),
            headers=headers(SOURCE_TOKEN),
        )
        assert ingested.status_code == 200
        assistance = {"kind": "assistance", "note": "Team assistance requested"}
        first = await client.post(
            "/v2/incidents/incident-a/commands", json=assistance, headers=headers()
        )
        repeat = await client.post(
            "/v2/incidents/incident-a/commands", json=assistance, headers=headers()
        )
        assert first.status_code == repeat.status_code == 200
        assert first.json() == repeat.json()
        assert repeat.headers["idempotency-replayed"] == "true"
        snapshot = await client.get("/v2/incidents/incident-a/state", headers=headers())
        assert snapshot.json()["revision"] == 2
        assert snapshot.json()["alerts"][0]["created_by"]["principal_id"] == "officer-a"
        assert snapshot.headers["cache-control"] == "no-store"
        app.state.admission.release()


class ConnectedRequest:
    async def is_disconnected(self):
        return False


async def test_sse_replay_heartbeat_gap_and_connection_release(tmp_path):
    settings = live_settings(
        tmp_path, live_max_events_per_incident=10, live_sse_heartbeat_seconds=0.1
    )
    api = LiveAPI(settings)
    async with api.lifespan():
        officer = settings.live_principals[1]
        api.store.command(officer, "incident-a", "a", command("assistance", note="Help"), now=NOW)
        api.sse_connections = 1
        stream = api.event_stream(ConnectedRequest(), "incident-a", 0)
        assert await anext(stream) == ": connected\n\n"
        event = await anext(stream)
        assert "id: 1\nevent: incident\n" in event
        assert '"kind":"assistance"' in event
        assert "Help" not in event  # events do not leak notes/biometrics across role projections
        heartbeat = await asyncio.wait_for(anext(stream), timeout=1)
        assert heartbeat == ": heartbeat\n\n"
        await stream.aclose()
        assert api.sse_connections == 0
        for index in range(11):
            api.store.ingest(settings.live_principals[0], telemetry(index), now=NOW)
        api.sse_connections = 1
        gap_stream = api.event_stream(ConnectedRequest(), "incident-a", 0)
        await anext(gap_stream)
        assert "event: resync_required" in await anext(gap_stream)
        with pytest.raises(StopAsyncIteration):
            await anext(gap_stream)
        assert api.sse_connections == 0


async def test_invalid_cursor_and_connection_limit_are_http_errors(tmp_path):
    async with service(tmp_path, live_max_sse_connections=1) as (client, app):
        bad = await client.get("/v2/incidents/incident-a/events?after=bad", headers=headers())
        assert bad.status_code == 400
        app.state.live_api.sse_connections = 1
        limited = await client.get("/v2/incidents/incident-a/events", headers=headers())
        assert limited.status_code == 429
        app.state.live_api.sse_connections = 0


def test_storage_failure_never_returns_durable_acknowledgment(tmp_path):
    store = LiveStore(live_settings(tmp_path))
    officer = store.settings.live_principals[1]
    store.connection.execute("PRAGMA query_only=ON")
    try:
        with pytest.raises(Exception, match="live_store_unavailable"):
            store.command(officer, "incident-a", "failure", command("assistance", note="Help"))
        assert store.snapshot("incident-a").revision == 0
    finally:
        store.close()
