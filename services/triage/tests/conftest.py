"""Tests must never consume a developer's live service credentials or model config."""

import os

import pytest

from triage.config import Settings


@pytest.fixture(autouse=True)
def isolate_service_environment(monkeypatch):
    monkeypatch.setitem(Settings.model_config, "env_file", None)
    for name in os.environ:
        if name.startswith("TRIAGE_"):
            monkeypatch.delenv(name)
