"""Exercise real local models with a synthetic frame; this does not evaluate accuracy."""

import base64
import io
import json
import os
import tempfile
from datetime import UTC, datetime
from pathlib import Path

from fastapi.testclient import TestClient
from PIL import Image

from triage.app import create_app
from triage.config import Settings


def main():
    settings = Settings()
    if settings.vision_provider != "ollama":
        raise SystemExit("The local smoke test requires TRIAGE_VISION_PROVIDER=ollama")
    runtime = Path(".runtime").resolve()
    for name in ("ultralytics", "matplotlib"):
        (runtime / name).mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("YOLO_CONFIG_DIR", str(runtime / "ultralytics"))
    os.environ.setdefault("MPLCONFIGDIR", str(runtime / "matplotlib"))
    buffer = io.BytesIO()
    with Image.new("RGB", (128, 128), (180, 180, 180)) as image:
        image.save(buffer, "PNG")
    headers = {
        "Authorization": f"Bearer {settings.api_token.get_secret_value()}",
        "Idempotency-Key": "local-synthetic-smoke",
    }
    with tempfile.TemporaryDirectory(prefix="gridlens-smoke-") as directory:
        config = settings.model_copy(update={"database_path": Path(directory) / "smoke.sqlite3"})
        with TestClient(create_app(config)) as client:
            assert client.get("/health/live").status_code == 200
            assert client.get("/health/ready").status_code == 401
            ready = client.get("/health/ready", headers=headers)
            if ready.status_code != 200:
                raise SystemExit(f"Models are not ready: {ready.json()}")
            payload = {
                "source_id": "synthetic-smoke",
                "captured_at": datetime.now(UTC).isoformat(),
                "image_base64": base64.b64encode(buffer.getvalue()).decode(),
                "media_type": "image/png",
                "allow_cloud": False,
            }
            response = client.post("/v1/triage", headers=headers, json=payload)
            result = response.json()
            assert response.status_code == 200, result
            assert result["requires_human_review"] is True
            assert result["confidence_semantics"] == "uncalibrated_model_scores"
            if result["assessment"] is None:
                raise SystemExit(f"Model assessment failed: {result['warnings']}")
            providers = {model["provider"] for model in result["models"]}
            if "ollama" not in providers or (
                settings.yolo_enabled and "ultralytics" not in providers
            ):
                raise SystemExit(f"Required model inference failed: {result['warnings']}")
            replay = client.post("/v1/triage", headers=headers, json=payload)
            assert replay.status_code == 200 and replay.json() == result
            assert replay.headers["idempotency-replayed"] == "true"
            conflict = client.post(
                "/v1/triage", headers=headers, json={**payload, "source_id": "different"}
            )
            assert conflict.status_code == 409
            report = {
                "checked_at": datetime.now(UTC).isoformat(),
                "models": result["models"],
                "status": result["status"],
                "review_priority": result["review_priority"],
                "warnings": result["warnings"],
                "timings_ms": result["timings_ms"],
                "auth_replay_conflict": "passed",
                "input": "synthetic gray frame; not a hazard accuracy evaluation",
            }
            (runtime / "smoke-report.json").write_text(json.dumps(report, indent=2) + "\n")
            print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
