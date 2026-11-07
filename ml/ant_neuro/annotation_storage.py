"""Persistence for reviewer decisions and confirmed gesture intervals."""

from __future__ import annotations

import json
import math
from pathlib import Path

import pandas as pd

from ml.ant_neuro.signals import ANNOTATION_LABELS

ANNOTATION_COLUMNS = ["file", "start_seconds", "end_seconds", "label"]


def load_review_state(path: Path) -> dict:
    if not path.exists():
        return {"recordings": {}}
    content = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(content, dict) or not isinstance(content.get("recordings"), dict):
        raise ValueError(f"Invalid review-state file: {path}")
    return content


def save_annotations(state: dict, review_path: Path, annotation_path: Path) -> None:
    rows = []
    for filename, events in state["recordings"].items():
        for event in events:
            if event.get("status") != "confirmed":
                continue
            start = float(event["review_start_seconds"])
            end = float(event["review_end_seconds"])
            label = event["label"]
            if (
                not math.isfinite(start)
                or not math.isfinite(end)
                or start < 0
                or end <= start
                or label not in ANNOTATION_LABELS
            ):
                raise ValueError(f"Invalid confirmed annotation: {filename} {event['event_id']}")
            rows.append({
                "file": filename,
                "start_seconds": round(start, 3),
                "end_seconds": round(end, 3),
                "label": label,
            })

    annotation_path.parent.mkdir(parents=True, exist_ok=True)
    review_path.parent.mkdir(parents=True, exist_ok=True)
    frame = pd.DataFrame(rows, columns=ANNOTATION_COLUMNS)
    if not frame.empty:
        frame = frame.sort_values(["file", "start_seconds"], ignore_index=True)

    review_temporary = review_path.with_suffix(review_path.suffix + ".tmp")
    annotations_temporary = annotation_path.with_suffix(annotation_path.suffix + ".tmp")
    review_temporary.write_text(json.dumps(state, indent=2), encoding="utf-8")
    frame.to_csv(annotations_temporary, index=False)
    review_temporary.replace(review_path)
    annotations_temporary.replace(annotation_path)
