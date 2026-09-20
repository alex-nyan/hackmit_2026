"""Explicit synthetic replay for the shared v2 incident; never a live-data fallback.

Run from services/triage: python -m scripts.live_demo init, then serve, then replay.
Generated secrets stay in ignored mode-0600 files and are never printed.
"""

import argparse
import json
import os
import secrets
import uuid
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import urlsplit

import httpx

from triage.config import Settings
from triage.live_schemas import TelemetryRequest

DEFAULT_ENV = Path(".runtime/live-demo.env")


def private_write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    with os.fdopen(descriptor, "w") as destination:
        destination.write(text)


def initialize(env_path: Path) -> tuple[Path, Path]:
    credentials_path = env_path.with_suffix(".credentials.json")
    if env_path.exists() or credentials_path.exists():
        raise ValueError(
            "Demo configuration already exists; use it without regenerating identities"
        )
    tokens = {
        role: secrets.token_urlsafe(40) for role in ["source", "officer", "dispatch", "hospital"]
    }
    sources = [
        {
            "source_id": "replay-watch",
            "incident_id": "replay-demo",
            "kind": "watch",
            "display_name": "SIMULATED responder Watch",
            "wearer_id": "simulated-responder",
            "wearer_role": "responder",
        },
        {
            "source_id": "replay-gps",
            "incident_id": "replay-demo",
            "kind": "gps",
            "display_name": "SIMULATED phone GPS",
        },
        {
            "source_id": "replay-camera",
            "incident_id": "replay-demo",
            "kind": "camera",
            "display_name": "SIMULATED camera health; no video",
        },
    ]
    principals = [
        {
            "principal_id": "replay-" + role,
            "token": token,
            "role": role,
            "incident_ids": ["replay-demo"],
            "source_ids": [source["source_id"] for source in sources]
            if role == "source"
            else ["replay-gps", "replay-camera"]
            if role == "hospital"
            else [],
        }
        for role, token in tokens.items()
    ]
    config = {
        "TRIAGE_API_TOKEN": secrets.token_urlsafe(40),
        "TRIAGE_DATABASE_PATH": "data/replay-v1.sqlite3",
        "TRIAGE_YOLO_ENABLED": "false",
        "TRIAGE_TRANSCRIPTION_ENABLED": "false",
        "TRIAGE_LIVE_ENABLED": "true",
        "TRIAGE_LIVE_DATABASE_PATH": "data/replay-live.sqlite3",
        "TRIAGE_LIVE_INCIDENT_IDS": json.dumps(["replay-demo"]),
        "TRIAGE_LIVE_SOURCES": json.dumps(sources, separators=(",", ":")),
        "TRIAGE_LIVE_PRINCIPALS": json.dumps(principals, separators=(",", ":")),
    }
    body = "# SYNTHETIC REPLAY ONLY. Private credentials; do not commit.\n"
    body += "\n".join(f"{key}='{value}'" for key, value in config.items()) + "\n"
    private_write(env_path, body)
    private_write(
        credentials_path,
        json.dumps(
            {
                "incident_id": "replay-demo",
                "warning": "SYNTHETIC REPLAY ONLY",
                "tokens": tokens,
            },
            indent=2,
        )
        + "\n",
    )
    return env_path, credentials_path


def replay(settings: Settings, base_url: str) -> dict:
    address = urlsplit(base_url)
    if (
        address.scheme not in {"http", "https"}
        or not address.hostname
        or address.username
        or address.password
        or address.query
        or address.fragment
        or address.path not in {"", "/"}
    ):
        raise ValueError("Use an HTTP(S) origin without credentials or path")
    if address.scheme == "http" and address.hostname not in {"localhost", "127.0.0.1", "::1"}:
        raise ValueError("Off-host replay requires HTTPS")
    principal = next(
        (item for item in settings.live_principals if item.principal_id == "replay-source"), None
    )
    if principal is None or principal.incident_ids != ["replay-demo"]:
        raise ValueError("Replay requires the dedicated configuration created by init")
    now = datetime.now(UTC).isoformat()
    boot = str(uuid.uuid4())
    packets = [
        ("replay-watch", "heart_rate", {"bpm": 85}),
        (
            "replay-gps",
            "location",
            {"latitude": 42.3598, "longitude": -71.0921, "horizontal_accuracy_m": 25},
        ),
        (
            "replay-camera",
            "source_health",
            {"availability": "unavailable", "reason": "synthetic_replay_no_camera_capture"},
        ),
    ]
    revisions = []
    with httpx.Client(
        base_url=base_url,
        timeout=10,
        headers={
            "Authorization": "Bearer " + principal.token.get_secret_value(),
        },
    ) as client:
        for source_id, kind, value in packets:
            payload = TelemetryRequest.model_validate(
                {
                    "incident_id": "replay-demo",
                    "source_id": source_id,
                    "samples": [
                        {
                            "sample_id": str(uuid.uuid4()),
                            "boot_id": boot,
                            "sequence": 0,
                            "measured_at": now,
                            "kind": kind,
                            "value": value,
                        }
                    ],
                }
            )
            response = client.post("/v2/ingest/telemetry", json=payload.model_dump(mode="json"))
            response.raise_for_status()
            revisions.append(response.json()["revision"])
        response = client.post(
            "/v2/incidents/replay-demo/commands",
            json={
                "kind": "assistance",
                "source_id": "replay-camera",
                "note": "SIMULATED replay: team assistance requested. No emergency-services call.",
            },
            headers={"Idempotency-Key": "replay-" + boot},
        )
        response.raise_for_status()
        revisions.append(response.json()["revision"])
    return {"mode": "synthetic_replay", "incident_id": "replay-demo", "revisions": revisions}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["init", "serve", "replay"])
    parser.add_argument("--env", type=Path, default=DEFAULT_ENV)
    parser.add_argument("--url", default="http://127.0.0.1:8090")
    parser.add_argument("--port", type=int, default=8090)
    arguments = parser.parse_args()
    try:
        if arguments.action == "init":
            paths = initialize(arguments.env)
            for path in paths:
                print(f"Created private replay file: {path.resolve()}")
            print("Start: python -m scripts.live_demo serve")
            print("Then: python -m scripts.live_demo replay")
        else:
            settings = Settings(_env_file=arguments.env)
            if arguments.action == "serve":
                import uvicorn

                from triage.app import create_app

                uvicorn.run(create_app(settings), host="127.0.0.1", port=arguments.port)
            else:
                print(json.dumps(replay(settings, arguments.url)))
    except (ValueError, OSError, httpx.HTTPError):
        # HTTP exceptions may contain request metadata; never print credentials or payloads.
        raise SystemExit(
            "Replay operation failed; verify paths, service status, and configuration"
        ) from None


if __name__ == "__main__":
    main()
