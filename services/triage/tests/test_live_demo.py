import json
import stat

import httpx
import pytest

from scripts.live_demo import initialize, replay
from triage.config import Settings
from triage.live_schemas import TelemetryRequest


def test_demo_init_uses_private_unique_credentials_and_explicit_simulation(tmp_path):
    env_path, credentials_path = initialize(tmp_path / ".runtime" / "live-demo.env")
    for path in (env_path, credentials_path):
        assert stat.S_IMODE(path.stat().st_mode) == 0o600
    settings = Settings(_env_file=env_path)
    credentials = json.loads(credentials_path.read_text())
    tokens = list(credentials["tokens"].values())
    assert len(set(tokens)) == 4
    assert settings.api_token.get_secret_value() not in tokens
    assert settings.live_enabled
    assert not settings.yolo_enabled and not settings.transcription_enabled
    assert all(source.display_name.startswith("SIMULATED") for source in settings.live_sources)
    assert settings.live_incident_ids == ["replay-demo"]
    with pytest.raises(ValueError, match="already exists"):
        initialize(env_path)
    assert credentials_path.read_text() == json.dumps(credentials, indent=2) + "\n"


def test_demo_replay_matches_wire_and_refuses_cleartext_off_host(tmp_path, monkeypatch):
    env_path, _ = initialize(tmp_path / "live-demo.env")
    settings = Settings(_env_file=env_path)
    requests = []

    def handler(request):
        payload = json.loads(request.content)
        if request.url.path.endswith("telemetry"):
            TelemetryRequest.model_validate(payload)
        else:
            assert payload["kind"] == "assistance"
            assert payload["note"].startswith("SIMULATED")
        requests.append(request.url.path)
        return httpx.Response(200, json={"revision": len(requests)})

    original_client = httpx.Client
    monkeypatch.setattr(
        "scripts.live_demo.httpx.Client",
        lambda **kwargs: original_client(**kwargs, transport=httpx.MockTransport(handler)),
    )
    output = replay(settings, "http://127.0.0.1:8090")
    assert output == {
        "mode": "synthetic_replay",
        "incident_id": "replay-demo",
        "revisions": [1, 2, 3, 4],
    }
    with pytest.raises(ValueError, match="HTTPS"):
        replay(settings, "http://192.168.1.15:8090")
    assert len(requests) == 4
