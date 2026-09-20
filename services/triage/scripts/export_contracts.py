"""Export reviewable JSON schemas for backend clients without starting any models."""

import argparse
import json
from pathlib import Path

from triage.schemas import (
    TranscriptionRequest,
    TranscriptionResult,
    TriageRequest,
    TriageResult,
)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    directory = Path(__file__).resolve().parents[1] / "contracts"
    contracts = [
        ("triage-request", TriageRequest),
        ("triage-result", TriageResult),
        ("transcription-request", TranscriptionRequest),
        ("transcription-result", TranscriptionResult),
    ]
    for name, contract in contracts:
        schema = {
            "$schema": "https://json-schema.org/draft/2020-12/schema",
            **contract.model_json_schema(),
        }
        expected = json.dumps(schema, indent=2, sort_keys=True) + "\n"
        path = directory / f"{name}.schema.json"
        if args.check:
            if not path.exists() or path.read_text() != expected:
                raise SystemExit(
                    f"Stale contract: {path.name}; run python -m scripts.export_contracts"
                )
        else:
            directory.mkdir(exist_ok=True)
            path.write_text(expected)


if __name__ == "__main__":
    main()
