"""Authenticated v2 endpoints, isolated from model admission and v1 credentials."""

import asyncio
import hmac
import json
import logging
import re
import uuid
from contextlib import asynccontextmanager

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, Response, StreamingResponse
from pydantic import TypeAdapter, ValidationError
from starlette.requests import ClientDisconnect

from triage.config import Settings
from triage.live_media import LiveMedia
from triage.live_media_schemas import MediaRequest
from triage.live_schemas import IncidentCommand, SessionInfo, TelemetryRequest
from triage.live_store import LiveError, LiveStore, require_incident

KEY_PATTERN = re.compile(r"^[A-Za-z0-9_.:-]{1,128}$")
command_adapter = TypeAdapter(IncidentCommand)
media_adapter = TypeAdapter(MediaRequest)
audit = logging.getLogger("triage.audit")


class LiveAPI:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.store: LiveStore | None = None
        self.media: LiveMedia | None = None
        self.router = APIRouter()
        self.sse_connections = 0
        self.ingress_active = {"media": 0, "telemetry": 0, "command": 0}
        self._routes()

    @asynccontextmanager
    async def lifespan(self):
        if self.settings.live_enabled:
            self.store = LiveStore(self.settings)
        try:
            if self.settings.live_media_enabled and self.store is not None:
                self.media = LiveMedia(self.settings, self.store)
                await self.media.start()
            yield
        finally:
            try:
                if self.media is not None:
                    await self.media.close()
                    self.media = None
            finally:
                if self.store is not None:
                    self.store.close()
                    self.store = None

    def authenticate(self, request: Request):
        if not self.settings.live_enabled:
            raise LiveError(404, "live_disabled")
        supplied = request.headers.get("authorization", "").encode("utf-8")
        selected = None
        for principal in self.settings.live_principals:
            expected = ("Bearer " + principal.token.get_secret_value()).encode("ascii")
            if hmac.compare_digest(supplied, expected):
                selected = principal
        if selected is None:
            raise LiveError(401, "unauthorized")
        return selected

    def require_store(self) -> LiveStore:
        if self.store is None:
            raise LiveError(503, "live_store_unavailable")
        return self.store

    async def body(
        self,
        request: Request,
        limit: int | None = None,
        *,
        admission: str = "telemetry",
    ) -> bytes:
        slots = getattr(self.settings, f"live_{admission}_ingress_limit")
        if self.ingress_active[admission] >= slots:
            raise LiveError(429, f"{admission}_ingress_busy")
        self.ingress_active[admission] += 1
        try:
            return await self._bounded_body(request, limit)
        finally:
            self.ingress_active[admission] -= 1

    async def _bounded_body(self, request: Request, limit: int | None = None) -> bytes:
        limit = limit or self.settings.live_max_request_bytes
        if request.headers.get("content-encoding", "identity").lower() != "identity":
            raise LiveError(415, "unsupported_content_encoding")
        content_type = request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
        if content_type != "application/json":
            raise LiveError(415, "json_required")
        length = request.headers.get("content-length")
        if length is not None:
            if not length.isascii() or not length.isdecimal():
                raise LiveError(400, "invalid_content_length")
            if len(length) > 12 or int(length) > limit:
                raise LiveError(413, "request_too_large")
        result = bytearray()
        try:
            async with asyncio.timeout(self.settings.request_read_timeout_seconds):
                async for chunk in request.stream():
                    if len(result) + len(chunk) > limit:
                        raise LiveError(413, "request_too_large")
                    result.extend(chunk)
        except TimeoutError:
            raise LiveError(408, "request_read_timeout") from None
        except ClientDisconnect:
            raise LiveError(400, "client_disconnected") from None
        return bytes(result)

    @staticmethod
    def response(value, **kwargs):
        return JSONResponse(
            value.model_dump(mode="json"), headers={"Cache-Control": "no-store"}, **kwargs
        )

    @staticmethod
    def error(error: LiveError):
        headers = {"Cache-Control": "no-store", "X-Request-ID": str(uuid.uuid4())}
        if error.status == 401:
            headers["WWW-Authenticate"] = "Bearer"
        if error.status in {429, 503}:
            headers["Retry-After"] = "2"
        return JSONResponse(
            {"error": {"code": error.code}}, status_code=error.status, headers=headers
        )

    def _routes(self):
        @self.router.post("/v2/ingest/media")
        async def media(request: Request):
            try:
                principal = self.authenticate(request)
                if principal.role != "source":
                    raise LiveError(403, "source_forbidden")
                if self.media is None:
                    raise LiveError(503, "live_media_unavailable")
                try:
                    payload = media_adapter.validate_json(
                        await self.body(
                            request,
                            self.settings.live_media_max_request_bytes,
                            admission="media",
                        )
                    )
                except (ValidationError, ValueError):
                    raise LiveError(422, "invalid_request") from None
                return self.response(self.media.admit(principal, payload), status_code=202)
            except LiveError as error:
                return self.error(error)

        @self.router.get("/v2/evidence/{evidence_id}")
        async def evidence(evidence_id: str, request: Request):
            try:
                principal = self.authenticate(request)
                if self.media is None:
                    raise LiveError(503, "live_media_unavailable")
                item = self.media.evidence(principal, evidence_id)
                audit.info(
                    json.dumps(
                        {
                            "event": "evidence_access",
                            "principal_id": principal.principal_id,
                            "incident_id": item.incident_id,
                            "evidence_id": evidence_id,
                        },
                        separators=(",", ":"),
                    )
                )
                return Response(
                    item.data,
                    media_type=item.content_type,
                    headers={
                        "Cache-Control": "no-store",
                        "X-Content-Type-Options": "nosniff",
                        "Content-Disposition": "inline",
                    },
                )
            except LiveError as error:
                return self.error(error)

        @self.router.get("/v2/session")
        async def session(request: Request):
            try:
                principal = self.authenticate(request)
                return self.response(
                    SessionInfo(
                        principal_id=principal.principal_id,
                        role=principal.role,
                        incident_ids=principal.incident_ids,
                        source_ids=principal.source_ids,
                    )
                )
            except LiveError as error:
                return self.error(error)

        @self.router.post("/v2/ingest/telemetry")
        async def telemetry(request: Request):
            try:
                principal = self.authenticate(request)
                if principal.role != "source":
                    raise LiveError(403, "source_forbidden")
                store = self.require_store()
                try:
                    payload = TelemetryRequest.model_validate_json(await self.body(request))
                except (ValidationError, ValueError):
                    raise LiveError(422, "invalid_request") from None
                return self.response(store.ingest(principal, payload))
            except LiveError as error:
                return self.error(error)

        @self.router.get("/v2/incidents/{incident_id}/state")
        async def snapshot(incident_id: str, request: Request):
            try:
                principal = self.authenticate(request)
                if principal.role == "source":
                    raise LiveError(403, "operator_required")
                require_incident(principal, incident_id)
                return self.response(self.require_store().snapshot(incident_id, principal))
            except LiveError as error:
                return self.error(error)

        @self.router.post("/v2/incidents/{incident_id}/commands")
        async def command(incident_id: str, request: Request):
            try:
                principal = self.authenticate(request)
                require_incident(principal, incident_id)
                key = request.headers.get("idempotency-key", "")
                if not KEY_PATTERN.fullmatch(key):
                    raise LiveError(400, "invalid_idempotency_key")
                store = self.require_store()
                try:
                    payload = command_adapter.validate_json(
                        await self.body(request, admission="command")
                    )
                except (ValidationError, ValueError):
                    raise LiveError(422, "invalid_request") from None
                receipt, replayed = store.command(principal, incident_id, key, payload)
                return JSONResponse(
                    receipt.model_dump(mode="json"),
                    headers={
                        "Cache-Control": "no-store",
                        "Idempotency-Replayed": str(replayed).lower(),
                    },
                )
            except LiveError as error:
                return self.error(error)

        @self.router.get("/v2/incidents/{incident_id}/events")
        async def events(incident_id: str, request: Request):
            try:
                principal = self.authenticate(request)
                if principal.role == "source":
                    raise LiveError(403, "operator_required")
                require_incident(principal, incident_id)
                store = self.require_store()
                raw_cursor = request.headers.get("last-event-id", request.query_params.get("after"))
                if raw_cursor is None:
                    cursor = store.snapshot(incident_id, principal).revision
                elif (
                    not raw_cursor.isascii()
                    or not raw_cursor.isdecimal()
                    or len(raw_cursor) > 16
                    or int(raw_cursor) > 9_007_199_254_740_991
                ):
                    raise LiveError(400, "invalid_event_cursor")
                else:
                    cursor = int(raw_cursor)
                # Check store/auth before beginning a response that cannot change status.
                store.events_after(incident_id, cursor)
                if self.sse_connections >= self.settings.live_max_sse_connections:
                    raise LiveError(429, "too_many_event_connections")
                self.sse_connections += 1
                return StreamingResponse(
                    self.event_stream(request, incident_id, cursor),
                    media_type="text/event-stream",
                    headers={
                        "Cache-Control": "no-store",
                        "X-Accel-Buffering": "no",
                        "Connection": "keep-alive",
                    },
                )
            except LiveError as error:
                return self.error(error)

    async def event_stream(self, request: Request, incident_id: str, cursor: int):
        try:
            yield ": connected\n\n"
            loop = asyncio.get_running_loop()
            last_heartbeat = loop.time()
            while not await request.is_disconnected():
                try:
                    events, gap, revision = self.require_store().events_after(incident_id, cursor)
                except LiveError:
                    yield 'event: unavailable\ndata: {"error":"live_store_unavailable"}\n\n'
                    return
                if gap:
                    data = json.dumps({"incident_id": incident_id, "revision": revision})
                    yield f"event: resync_required\ndata: {data}\n\n"
                    return
                for event in events:
                    yield (
                        f"id: {event.revision}\nevent: incident\n"
                        f"data: {event.model_dump_json()}\n\n"
                    )
                    cursor = event.revision
                if loop.time() - last_heartbeat >= self.settings.live_sse_heartbeat_seconds:
                    yield ": heartbeat\n\n"
                    last_heartbeat = loop.time()
                await asyncio.sleep(min(0.25, self.settings.live_sse_heartbeat_seconds))
        finally:
            self.sse_connections -= 1
