"""Run a bounded real-HTTP integration smoke against an isolated local service.

Uses a fresh temporary database, random in-memory credentials, an inherited
loopback socket, and disabled models. No existing service or deployment is used.
Run from the repository root with services/triage/.venv/bin/python followed by
this file's path. Only check results are printed; credentials never enter argv.
"""

import argparse
import base64
import io
import json
import os
import secrets
import socket
import subprocess
import sys
import tempfile
import time
from datetime import UTC, datetime
from pathlib import Path

import httpx

SERVICE_ROOT = Path(__file__).resolve().parents[1]
INCIDENT = "smoke-incident"
WATCH = "smoke-responder-watch"
CAMERA = "smoke-camera"
DEVICE = "smoke-device"
PATIENT_A = "smoke-patient-a"
PATIENT_B = "smoke-patient-b"


class SmokeFailure(Exception):
    """Descriptions contain only fixed check names/status codes, never response bodies."""


def require(condition: bool, description: str) -> None:
    if not condition:
        raise SmokeFailure(description)


def settings_for(directory: Path, tokens: dict[str, str]) -> dict:
    sources = [
        {
            "source_id": WATCH,
            "incident_id": INCIDENT,
            "kind": "watch",
            "display_name": "Synthetic smoke responder Watch",
            "wearer_id": "smoke-responder",
            "wearer_role": "responder",
        },
        {
            "source_id": CAMERA,
            "incident_id": INCIDENT,
            "kind": "camera",
            "display_name": "Synthetic smoke camera",
        },
        {
            "source_id": DEVICE,
            "incident_id": INCIDENT,
            "kind": "device",
            "display_name": "Synthetic smoke phone",
        },
    ]
    return {
        "api_token": secrets.token_urlsafe(40),
        "database_path": str(directory / "legacy.sqlite3"),
        "live_database_path": str(directory / "live.sqlite3"),
        "live_enabled": True,
        "live_media_enabled": True,
        "live_context_enabled": False,
        "yolo_enabled": False,
        "transcription_enabled": False,
        "cloud_enabled": False,
        "cloud_fallback_enabled": False,
        "vision_provider": "ollama",
        "ollama_base_url": "http://127.0.0.1:1",
        "live_sse_heartbeat_seconds": 0.2,
        "request_read_timeout_seconds": 2,
        "live_incident_ids": [INCIDENT],
        "live_sources": sources,
        "live_patients": [
            {
                "patient_id": patient_id,
                "incident_id": INCIDENT,
                "display_name": f"SIMULATED {patient_id}",
            }
            for patient_id in [PATIENT_A, PATIENT_B]
        ],
        "live_principals": [
            {
                "principal_id": "smoke-" + role,
                "token": tokens[role],
                "role": role,
                "incident_ids": [INCIDENT],
                # Explicitly granting the Watch to the hospital still must not
                # expose a responder's measurements: role projection must win.
                "source_ids": [WATCH, CAMERA, DEVICE] if role in {"source", "hospital"} else [],
                "patient_ids": [PATIENT_A]
                if role == "hospital"
                else [PATIENT_A, PATIENT_B]
                if role == "dispatch"
                else [],
            }
            for role in ["source", "officer", "dispatch", "hospital"]
        ],
    }


def serve_inherited_socket(descriptor: int) -> None:
    # This private worker invocation receives settings over stdin, not argv,
    # environment variables, repository files, or application log output.
    sys.path.insert(0, str(SERVICE_ROOT))
    import uvicorn

    from triage.app import create_app
    from triage.config import Settings

    encoded = sys.stdin.buffer.read(65_537)
    if len(encoded) > 65_536:
        raise SystemExit(2)
    settings = Settings(_env_file=None, **json.loads(encoded))
    listener = socket.socket(fileno=descriptor)
    config = uvicorn.Config(
        create_app(settings),
        log_level="critical",
        access_log=False,
        timeout_graceful_shutdown=2,
        lifespan="on",
    )
    uvicorn.Server(config).run(sockets=[listener])


class LocalService:
    def __init__(self, configuration: dict):
        self.configuration = configuration
        self.process: subprocess.Popen | None = None
        self.listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.listener.bind(("127.0.0.1", 0))
        self.listener.listen(32)
        self.url = f"http://127.0.0.1:{self.listener.getsockname()[1]}"

    def start(self) -> None:
        require(self.process is None, "service already running")
        environment = {
            key: value for key, value in os.environ.items() if not key.startswith("TRIAGE_")
        }
        environment["PYTHONUNBUFFERED"] = "1"
        self.process = subprocess.Popen(
            [
                sys.executable,
                str(Path(__file__).resolve()),
                "--serve-fd",
                str(self.listener.fileno()),
            ],
            stdin=subprocess.PIPE,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            pass_fds=(self.listener.fileno(),),
            env=environment,
        )
        require(self.process.stdin is not None, "private configuration pipe unavailable")
        self.process.stdin.write(json.dumps(self.configuration).encode())
        self.process.stdin.close()
        deadline = time.monotonic() + 10
        with httpx.Client(base_url=self.url, trust_env=False, timeout=0.3) as client:
            while time.monotonic() < deadline:
                require(self.process.poll() is None, "temporary service failed to start")
                try:
                    if client.get("/health/live").status_code == 200:
                        return
                except httpx.HTTPError:
                    pass
                time.sleep(0.05)
        raise SmokeFailure("temporary service readiness deadline exceeded")

    def stop(self) -> None:
        process, self.process = self.process, None
        if process is None:
            return
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=4)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=2)
        else:
            process.wait(timeout=1)

    def close(self) -> None:
        try:
            self.stop()
        finally:
            self.listener.close()


def check_http(response: httpx.Response, status: int, check: str) -> dict:
    require(response.status_code == status, f"{check}: unexpected HTTP {response.status_code}")
    try:
        value = response.json()
    except ValueError:
        raise SmokeFailure(f"{check}: response is not JSON") from None
    require(isinstance(value, dict), f"{check}: invalid envelope")
    return value


def read_sse(client: httpx.Client, headers: dict[str, str], expected_revision: int) -> None:
    deadline = time.monotonic() + 4
    with client.stream(
        "GET", f"/v2/incidents/{INCIDENT}/events?after=0", headers=headers, timeout=2
    ) as response:
        require(response.status_code == 200, "SSE HTTP status")
        require("text/event-stream" in response.headers.get("content-type", ""), "SSE media type")
        event: dict[str, str] = {}
        total = 0
        for line in response.iter_lines():
            total += len(line)
            require(total <= 16_384 and time.monotonic() < deadline, "SSE bounded read deadline")
            if not line:
                if event.get("event") == "incident":
                    value = json.loads(event.get("data", "{}"))
                    require(value.get("incident_id") == INCIDENT, "SSE incident isolation")
                    if value.get("revision") == expected_revision:
                        require(event.get("id") == str(expected_revision), "SSE replay cursor")
                        require(value.get("kind") == "telemetry", "SSE telemetry event")
                        return
                event = {}
            elif not line.startswith(":"):
                key, _, value = line.partition(":")
                event[key] = value.lstrip()
    raise SmokeFailure("SSE expected telemetry event missing")


def run_smoke() -> int:
    checks = 0

    def passed(description: str) -> None:
        nonlocal checks
        checks += 1
        print(f"PASS {checks:02d} {description}", flush=True)

    tokens = {
        role: secrets.token_urlsafe(40) for role in ["source", "officer", "dispatch", "hospital"]
    }
    auth = {role: {"Authorization": "Bearer " + token} for role, token in tokens.items()}
    with tempfile.TemporaryDirectory(prefix="paw-live-smoke-") as directory:
        service = LocalService(settings_for(Path(directory), tokens))
        try:
            service.start()
            passed("isolated loopback HTTP service started; models disabled")
            with httpx.Client(base_url=service.url, trust_env=False, timeout=3) as client:
                route = f"/v2/incidents/{INCIDENT}"
                boot_id = "smoke-boot"
                captured_at = datetime.now(UTC).isoformat()
                telemetry = {
                    "schema_version": "2.0",
                    "incident_id": INCIDENT,
                    "source_id": WATCH,
                    "samples": [
                        {
                            "sample_id": "smoke-heart-rate",
                            "boot_id": boot_id,
                            "sequence": 0,
                            "measured_at": captured_at,
                            "kind": "heart_rate",
                            "value": {"bpm": 83},
                        }
                    ],
                }
                receipt = check_http(
                    client.post("/v2/ingest/telemetry", json=telemetry, headers=auth["source"]),
                    200,
                    "telemetry",
                )
                require(receipt["results"][0]["status"] == "accepted", "telemetry acceptance")
                snapshot = check_http(
                    client.get(route + "/state", headers=auth["officer"]), 200, "officer snapshot"
                )
                readings = [
                    item for item in snapshot["observations"] if item["kind"] == "heart_rate"
                ]
                require(
                    len(readings) == 1 and readings[0]["subject_id"] == "smoke-responder",
                    "wearer association",
                )
                require(readings[0]["value"]["bpm"] == 83, "original measured value")
                require(
                    datetime.fromisoformat(readings[0]["measured_at"])
                    == datetime.fromisoformat(captured_at),
                    "original measurement time",
                )
                passed("source ingestion reaches authorized snapshot with original measurement")

                read_sse(client, auth["officer"], receipt["revision"])
                passed("real SSE stream replays committed telemetry revision")

                assistance_key = "smoke-assistance-" + secrets.token_hex(12)
                assistance = {
                    "kind": "assistance",
                    "source_id": DEVICE,
                    "note": "Synthetic smoke assistance; no external dispatch.",
                }
                assistance_headers = {**auth["source"], "Idempotency-Key": assistance_key}
                first = check_http(
                    client.post(route + "/commands", json=assistance, headers=assistance_headers),
                    200,
                    "assistance",
                )
                second_response = client.post(
                    route + "/commands", json=assistance, headers=assistance_headers
                )
                second = check_http(second_response, 200, "assistance replay")
                require(
                    first == second
                    and second_response.headers.get("Idempotency-Replayed") == "true",
                    "assistance idempotency",
                )
                snapshot = check_http(
                    client.get(route + "/state", headers=auth["dispatch"]), 200, "dispatch snapshot"
                )
                require(len(snapshot["alerts"]) == 1, "assistance creates exactly one alert")
                passed("assistance is server-receipted and retry creates no duplicate alert")

                acknowledged = check_http(
                    client.post(
                        route + "/commands",
                        headers={**auth["dispatch"], "Idempotency-Key": "smoke-ack"},
                        json={
                            "kind": "acknowledge",
                            "expected_revision": snapshot["revision"],
                            "alert_id": first["alert_id"],
                        },
                    ),
                    200,
                    "dispatch acknowledgment",
                )
                scene = check_http(
                    client.post(
                        route + "/commands",
                        headers={**auth["dispatch"], "Idempotency-Key": "smoke-scene"},
                        json={
                            "kind": "scene_report",
                            "expected_revision": acknowledged["revision"],
                            "status": "restricted",
                            "scope": "Synthetic smoke zone",
                            "note": "Human-authored integration test report.",
                            "valid_for_seconds": 60,
                        },
                    ),
                    200,
                    "human scene report",
                )
                snapshot = check_http(
                    client.get(route + "/state", headers=auth["officer"]),
                    200,
                    "shared action state",
                )
                require(
                    snapshot["alerts"][0]["attention"] == "acknowledged", "acknowledgment visible"
                )
                require(
                    snapshot["alerts"][0]["disposition"] == "open",
                    "acknowledgment must not resolve alert",
                )
                report = next(
                    item
                    for item in snapshot["scene_reports"]
                    if item["report_id"] == scene["report_id"]
                )
                require(
                    report["reported_by"]["principal_id"] == "smoke-dispatch"
                    and report["status"] == "restricted",
                    "human report attribution",
                )
                passed(
                    "dispatch acknowledgment and attributable scene report synchronize to officer"
                )

                hospital = check_http(
                    client.get(route + "/state", headers=auth["hospital"]),
                    200,
                    "hospital projection",
                )
                require(
                    all(item["source_id"] != WATCH for item in hospital["sources"]),
                    "hospital responder source exclusion",
                )
                require(
                    all(item["source_id"] != WATCH for item in hospital["observations"]),
                    "hospital responder biometric exclusion",
                )
                require(
                    client.get(route + "/state", headers=auth["source"]).status_code == 403,
                    "source cannot read incident",
                )
                require(
                    client.get(
                        "/v2/incidents/smoke-unassigned/state", headers=auth["officer"]
                    ).status_code
                    == 403,
                    "wrong incident denied",
                )
                require(
                    client.get(route + "/state").status_code == 401, "anonymous snapshot denied"
                )
                passed("hospital hides responder biometrics; unauthorized reads denied")

                handoff_ids = []
                for patient_id in [PATIENT_A, PATIENT_B]:
                    dispatch_state = check_http(
                        client.get(route + "/state", headers=auth["dispatch"]),
                        200,
                        "handoff current revision",
                    )
                    handoff = check_http(
                        client.post(
                            route + "/commands",
                            headers={
                                **auth["dispatch"],
                                "Idempotency-Key": "smoke-handoff-" + patient_id,
                            },
                            json={
                                "kind": "submit_handoff",
                                "expected_revision": dispatch_state["revision"],
                                "patient_id": patient_id,
                                "mechanism": f"SIMULATED human-reported mechanism for {patient_id}",
                                "injuries": None,
                                "signs": None,
                                "treatments": None,
                            },
                        ),
                        200,
                        "human MIST submission",
                    )
                    handoff_ids.append(handoff["handoff_id"])
                dispatch_state = check_http(
                    client.get(route + "/state", headers=auth["dispatch"]),
                    200,
                    "dispatch MIST records",
                )
                handoffs_before_restart = {
                    item["handoff_id"]: item for item in dispatch_state["handoffs"]
                }
                require(
                    set(handoffs_before_restart) == set(handoff_ids),
                    "dispatch sees both recorded handoffs",
                )
                for record in handoffs_before_restart.values():
                    require(
                        record["recorded_by"]["principal_id"] == "smoke-dispatch"
                        and record["recorded_by"]["role"] == "dispatch"
                        and record["provenance"] == "human_reported"
                        and record["delivery_status"] == "recorded_locally_not_transmitted",
                        "MIST human attribution and local-only delivery",
                    )
                    require(
                        all(record[field] is None for field in ["injuries", "signs", "treatments"]),
                        "unreported MIST fields remain unknown",
                    )
                hospital = check_http(
                    client.get(route + "/state", headers=auth["hospital"]),
                    200,
                    "hospital patient-scoped MIST",
                )
                require(
                    [item["patient_id"] for item in hospital["patients"]] == [PATIENT_A]
                    and [item["patient_id"] for item in hospital["handoffs"]] == [PATIENT_A],
                    "hospital sees only assigned patient and handoff",
                )
                officer = check_http(
                    client.get(route + "/state", headers=auth["officer"]),
                    200,
                    "officer patient privacy",
                )
                require(
                    officer["patients"] == [] and officer["handoffs"] == [],
                    "officer cannot read patient identity or MIST",
                )
                passed("human MIST records are local-only and isolated by patient and role")

                from PIL import Image

                image = Image.new("RGB", (8, 8), (30, 50, 70))
                data = io.BytesIO()
                image.save(data, format="JPEG")
                image.close()
                admitted = check_http(
                    client.post(
                        "/v2/ingest/media",
                        headers=auth["source"],
                        json={
                            "schema_version": "2.0",
                            "incident_id": INCIDENT,
                            "source_id": CAMERA,
                            "boot_id": boot_id,
                            "sequence": 0,
                            "captured_at": datetime.now(UTC).isoformat(),
                            "kind": "frame",
                            "media_type": "image/jpeg",
                            "data_base64": base64.b64encode(data.getvalue()).decode(),
                        },
                    ),
                    202,
                    "media admission",
                )
                require(
                    admitted["processing_semantics"] == "admitted_not_processed",
                    "admission is not inference",
                )
                deadline = time.monotonic() + 4
                machine = None
                while time.monotonic() < deadline:
                    snapshot = check_http(
                        client.get(route + "/state", headers=auth["officer"]),
                        200,
                        "media result snapshot",
                    )
                    machine = next(
                        (
                            item
                            for item in snapshot["observations"]
                            if item["observation_id"] == admitted["media_id"]
                        ),
                        None,
                    )
                    if machine is not None:
                        break
                    time.sleep(0.05)
                require(machine is not None, "media publication deadline")
                require(
                    machine["value"]["status"] == "unavailable"
                    and "detector_disabled" in machine["warnings"],
                    "disabled model reports unavailable",
                )
                require(
                    machine["value"]["detections"] == []
                    and machine["value"]["evidence_refs"] == [],
                    "disabled model produces no fabricated evidence",
                )
                passed("media HTTP202 admission independently publishes unavailable inference")

            service.stop()
            service.start()
            with httpx.Client(base_url=service.url, trust_env=False, timeout=3) as client:
                after = check_http(
                    client.get(route + "/state", headers=auth["officer"]), 200, "restart snapshot"
                )
                require(
                    len(after["alerts"]) == 1
                    and after["alerts"][0]["alert_id"] == first["alert_id"],
                    "durable assistance alert",
                )
                require(after["alerts"][0]["attention"] == "acknowledged", "durable acknowledgment")
                require(
                    any(item["report_id"] == scene["report_id"] for item in after["scene_reports"]),
                    "durable human report",
                )
                watch = next(item for item in after["sources"] if item["source_id"] == WATCH)
                require(
                    watch["availability"] == "unknown" and watch["reason"] == "service_restarted",
                    "restart breaks live coverage",
                )
                require(
                    all(item["freshness"] != "fresh" for item in after["observations"]),
                    "restart cannot revive old samples",
                )
                replay_response = client.post(
                    route + "/commands", headers=assistance_headers, json=assistance
                )
                replay = check_http(replay_response, 200, "durable assistance idempotency")
                require(
                    replay == first
                    and replay_response.headers.get("Idempotency-Replayed") == "true",
                    "idempotency survives restart",
                )
                dispatch_after = check_http(
                    client.get(route + "/state", headers=auth["dispatch"]),
                    200,
                    "durable MIST records",
                )
                require(
                    {item["handoff_id"]: item for item in dispatch_after["handoffs"]}
                    == handoffs_before_restart,
                    "MIST text, original attribution and local-only status survive restart",
                )
                hospital_after = check_http(
                    client.get(route + "/state", headers=auth["hospital"]),
                    200,
                    "durable patient access scope",
                )
                require(
                    [item["patient_id"] for item in hospital_after["handoffs"]] == [PATIENT_A]
                    and after["handoffs"] == [],
                    "restart preserves hospital and officer handoff isolation",
                )
                passed(
                    "process restart retains actions/idempotency and marks source coverage unknown"
                )
        finally:
            service.close()
    require(not Path(directory).exists(), "temporary database cleanup")
    passed("temporary service stopped and databases removed")
    return checks


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--serve-fd", type=int, help=argparse.SUPPRESS)
    arguments = parser.parse_args()
    if arguments.serve_fd is not None:
        serve_inherited_socket(arguments.serve_fd)
        return
    try:
        checks = run_smoke()
        print(f"PASS complete: {checks} loopback checks; no downloads or external calls.")
    except (SmokeFailure, httpx.HTTPError, OSError, ValueError, KeyError, StopIteration) as error:
        # HTTP exceptions can include metadata; print only our fixed check names.
        message = str(error) if isinstance(error, SmokeFailure) else type(error).__name__
        print(f"FAIL loopback smoke: {message}", file=sys.stderr)
        raise SystemExit(1) from None


if __name__ == "__main__":
    main()
