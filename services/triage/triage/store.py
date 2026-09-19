"""Single-process SQLite idempotency with bounded retention; never stores images."""

import hashlib
import sqlite3
import time
from dataclasses import dataclass
from pathlib import Path

from triage.schemas import TriageResult


class StoreError(Exception):
    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


@dataclass(frozen=True)
class Claim:
    replay: TriageResult | None = None


class ResultStore:
    """Use exactly one instance per database and one ASGI worker per deployment.

    Pending claims are removed when the owning process starts: no inference from
    that previous process can still complete. SQLite transactions make claims
    atomic within the single process. A full store rejects new keys rather than
    evicting unexpired results and unexpectedly repeating inference.
    """

    def __init__(self, path: Path, retention_hours: int, max_records: int):
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        self._db = sqlite3.connect(path, timeout=0, check_same_thread=False)
        path.chmod(0o600)
        self._db.execute("PRAGMA journal_mode=DELETE")
        # Hold one owner's connection lock for the service lifetime. A second
        # worker must fail before it can delete the first worker's pending claims.
        self._db.execute("PRAGMA locking_mode=EXCLUSIVE")
        self._db.execute("PRAGMA secure_delete=ON")
        self._db.execute("PRAGMA busy_timeout=0")
        try:
            self._db.execute(
                "CREATE TABLE IF NOT EXISTS requests ("
                "key_hash TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, "
                "state TEXT NOT NULL CHECK(state IN ('pending', 'complete')), "
                "expires_at REAL NOT NULL, result TEXT)"
            )
            self._db.execute("CREATE INDEX IF NOT EXISTS expiry ON requests(expires_at)")
            self._db.execute("DELETE FROM requests WHERE state = 'pending'")
            self._db.commit()
        except sqlite3.Error:
            self._db.close()
            raise StoreError("result_store_unavailable") from None
        self._ttl = retention_hours * 3600
        self._max_records = max_records

    @staticmethod
    def _key(key: str) -> str:
        return hashlib.sha256(key.encode("utf-8")).hexdigest()

    def claim(self, key: str, fingerprint: str, *, now: float | None = None) -> Claim:
        now = time.time() if now is None else now
        try:
            with self._db:
                self._db.execute("BEGIN IMMEDIATE")
                self._db.execute(
                    "DELETE FROM requests WHERE state = 'complete' AND expires_at <= ?", (now,)
                )
                row = self._db.execute(
                    "SELECT fingerprint, state, result FROM requests WHERE key_hash = ?",
                    (self._key(key),),
                ).fetchone()
                if row:
                    if row[0] != fingerprint:
                        raise StoreError("idempotency_conflict")
                    if row[1] == "pending":
                        raise StoreError("idempotency_in_progress")
                    return Claim(TriageResult.model_validate_json(row[2]))
                count = self._db.execute("SELECT COUNT(*) FROM requests").fetchone()[0]
                if count >= self._max_records:
                    raise StoreError("result_store_full")
                self._db.execute(
                    "INSERT INTO requests VALUES (?, ?, 'pending', ?, NULL)",
                    (self._key(key), fingerprint, now + self._ttl),
                )
                return Claim()
        except sqlite3.Error as error:
            raise StoreError("result_store_unavailable") from error

    def complete(
        self, key: str, fingerprint: str, result: TriageResult, *, now: float | None = None
    ) -> None:
        now = time.time() if now is None else now
        try:
            with self._db:
                cursor = self._db.execute(
                    "UPDATE requests SET state = 'complete', result = ?, expires_at = ? "
                    "WHERE key_hash = ? AND fingerprint = ? AND state = 'pending'",
                    (result.model_dump_json(), now + self._ttl, self._key(key), fingerprint),
                )
                if cursor.rowcount != 1:
                    raise StoreError("result_store_unavailable")
        except sqlite3.Error as error:
            raise StoreError("result_store_unavailable") from error

    def abandon(self, key: str, fingerprint: str) -> None:
        try:
            with self._db:
                self._db.execute(
                    "DELETE FROM requests WHERE key_hash = ? AND fingerprint = ? "
                    "AND state = 'pending'",
                    (self._key(key), fingerprint),
                )
        except sqlite3.Error as error:
            raise StoreError("result_store_unavailable") from error

    def close(self) -> None:
        self._db.close()
