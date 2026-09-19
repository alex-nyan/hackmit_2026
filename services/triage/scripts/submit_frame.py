"""Submit an operator-selected frame without printing credentials or image bytes."""

import argparse
import base64
import json
import mimetypes
import uuid
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import urlsplit

import httpx

from triage.config import Settings


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("image", type=Path)
    parser.add_argument("--source-id", default="operator-upload")
    parser.add_argument("--incident-id")
    parser.add_argument(
        "--captured-at", required=True, help="Actual capture time in ISO 8601 with timezone"
    )
    parser.add_argument("--url", default="http://127.0.0.1:8090")
    parser.add_argument("--idempotency-key", default=str(uuid.uuid4()))
    parser.add_argument(
        "--allow-cloud", action="store_true", help="Permit this frame to leave the machine"
    )
    args = parser.parse_args()
    config = Settings()
    url = urlsplit(args.url)
    if url.scheme != "https" and not (
        url.scheme == "http" and url.hostname in {"127.0.0.1", "localhost", "::1"}
    ):
        parser.error("Use HTTPS except for a local loopback service")
    if url.username or url.password or url.query or url.fragment:
        parser.error("Service URL must not contain credentials, query, or fragment")
    if args.image.stat().st_size > config.max_image_bytes:
        parser.error("Image exceeds the configured byte limit")
    captured_at = datetime.fromisoformat(args.captured_at.replace("Z", "+00:00"))
    if captured_at.tzinfo is None or captured_at > datetime.now(UTC):
        parser.error("Capture time must be timezone-aware and not in the future")
    payload = {
        "image_base64": base64.b64encode(args.image.read_bytes()).decode("ascii"),
        "media_type": mimetypes.guess_type(args.image.name)[0],
        "source_id": args.source_id,
        "incident_id": args.incident_id,
        "captured_at": captured_at.isoformat(),
        "allow_cloud": args.allow_cloud,
    }
    with httpx.Client(timeout=2 * config.provider_timeout_seconds + 60, trust_env=False) as client:
        result = client.post(
            f"{args.url.rstrip('/')}/v1/triage",
            headers={
                "Authorization": f"Bearer {config.api_token.get_secret_value()}",
                "Idempotency-Key": args.idempotency_key,
            },
            json=payload,
        )
    print(f"HTTP {result.status_code}")
    print(json.dumps(result.json(), indent=2))
    raise SystemExit(0 if result.is_success else 1)


if __name__ == "__main__":
    main()
