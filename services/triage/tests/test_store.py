from datetime import UTC, datetime

import pytest

from triage.schemas import TriageResult
from triage.store import ResultStore, StoreError


def result():
    return TriageResult(
        request_id="7c3cd82c-1b56-43fb-adc4-422615c69887",
        source_id="test",
        incident_id=None,
        captured_at=datetime.now(UTC),
        processed_at=datetime.now(UTC),
        image_sha256="a" * 64,
        status="insufficient_evidence",
        review_priority="insufficient_evidence",
        assessment=None,
        detections=[],
        models=[],
        warnings=["vision_inference_failed"],
        timings_ms={},
    )


def test_persisted_replay_and_conflict(tmp_path):
    path = tmp_path / "private" / "results.sqlite3"
    store = ResultStore(path, 1, 10)
    assert store.claim("secret-key", "digest").replay is None
    with pytest.raises(StoreError, match="in_progress"):
        store.claim("secret-key", "digest")
    with pytest.raises(StoreError, match="conflict"):
        store.claim("secret-key", "different")
    expected = result()
    store.complete("secret-key", "digest", expected)
    store.close()
    assert path.stat().st_mode & 0o777 == 0o600
    assert path.parent.stat().st_mode & 0o777 == 0o700
    assert b"secret-key" not in path.read_bytes()
    store = ResultStore(path, 1, 10)
    assert store.claim("secret-key", "digest").replay == expected
    store.close()


def test_startup_recovers_abandoned_process_claims(tmp_path):
    path = tmp_path / "results.sqlite3"
    store = ResultStore(path, 1, 10)
    store.claim("interrupted", "digest")
    store.close()
    store = ResultStore(path, 1, 10)
    assert store.claim("interrupted", "digest").replay is None
    store.close()


def test_capacity_and_expiration_are_bounded(tmp_path):
    store = ResultStore(tmp_path / "results.sqlite3", 1, 1)
    store.claim("first", "digest", now=0)
    store.complete("first", "digest", result(), now=0)
    assert store.claim("first", "digest", now=10).replay is not None
    with pytest.raises(StoreError, match="full"):
        store.claim("second", "digest", now=10)
    assert store.claim("second", "digest", now=3601).replay is None
    store.abandon("second", "digest")
    assert store.claim("third", "digest", now=3601).replay is None
    store.close()


def test_completed_record_cannot_be_abandoned_or_overwritten(tmp_path):
    store = ResultStore(tmp_path / "results.sqlite3", 1, 10)
    store.claim("key", "digest")
    expected = result()
    store.complete("key", "digest", expected)
    store.abandon("key", "digest")
    with pytest.raises(StoreError, match="unavailable"):
        store.complete("key", "other", result())
    assert store.claim("key", "digest").replay == expected
    store.close()


def test_second_worker_cannot_clear_active_claim(tmp_path):
    path = tmp_path / "results.sqlite3"
    owner = ResultStore(path, 1, 10)
    owner.claim("active-key", "digest")
    try:
        with pytest.raises((StoreError, __import__("sqlite3").OperationalError)):
            ResultStore(path, 1, 10)
        with pytest.raises(StoreError, match="in_progress"):
            owner.claim("active-key", "digest")
    finally:
        owner.close()


def test_retention_never_deletes_active_inference_and_starts_at_completion(tmp_path):
    store = ResultStore(tmp_path / "results.sqlite3", 1, 10)
    try:
        store.claim("slow", "digest", now=0)
        store.claim("later", "digest", now=3601)
        with pytest.raises(StoreError, match="in_progress"):
            store.claim("slow", "digest", now=3602)
        expected = result()
        store.complete("slow", "digest", expected, now=3602)
        assert store.claim("slow", "digest", now=3603).replay == expected
        assert store.claim("slow", "digest", now=7203).replay is None
    finally:
        store.close()
