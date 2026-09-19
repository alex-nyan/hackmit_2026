"""Explicit trusted-model provisioning; never run as part of request handling."""

import argparse
import hashlib
import os
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--model", choices=["yolo26n.pt", "yolo26s.pt", "yolo26m.pt"], default="yolo26n.pt"
    )
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    models = root / "models"
    models.mkdir(exist_ok=True)
    (root / ".runtime" / "ultralytics").mkdir(parents=True, exist_ok=True)
    (root / ".runtime" / "matplotlib").mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("YOLO_CONFIG_DIR", str(root / ".runtime" / "ultralytics"))
    os.environ.setdefault("MPLCONFIGDIR", str(root / ".runtime" / "matplotlib"))
    os.chdir(models)
    from ultralytics import YOLO

    # The operator explicitly authorizes this download by invoking this script.
    YOLO(args.model)
    digest = hashlib.sha256((models / args.model).read_bytes()).hexdigest()
    print(f"TRIAGE_YOLO_WEIGHTS=models/{args.model}")
    print(f"TRIAGE_YOLO_SHA256={digest}")


if __name__ == "__main__":
    main()
