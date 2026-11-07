"""Inspect ANT Neuro CNT recordings and write unlabelled signal candidates."""

from __future__ import annotations

import json
import re
from pathlib import Path

import antio
import mne
import numpy as np

from ml.ant_neuro.signals import (
    REPOSITORY_ROOT,
    detect_candidates,
    read_ant_recording,
    recording_paths,
)

REPORT_DIR = REPOSITORY_ROOT / "ml" / "ant_neuro" / "reports"


def _header_value(path: Path, key: str) -> str | None:
    text = path.read_bytes()[:4096].decode("latin-1", errors="replace")
    match = re.search(r"\[" + re.escape(key) + r"\]\s*\r?\n([^\r\n]+)", text)
    return match.group(1).strip() if match else None


def inspect_recordings(paths: list[Path] | None = None) -> dict[str, object]:
    records = []
    for path in paths or recording_paths():
        raw = read_ant_recording(path)
        data = raw.get_data()
        events = detect_candidates(raw)
        measured_at = raw.info.get("meas_date")
        records.append({
            "file": path.name,
            "format": "ANT Neuro CNT/eeph",
            "file_version": _header_value(path, "File Version"),
            "sampling_hz": float(raw.info["sfreq"]),
            "samples": int(raw.n_times),
            "duration_seconds": round(raw.n_times / float(raw.info["sfreq"]), 3),
            "measurement_start": measured_at.isoformat() if measured_at else None,
            "channel_names": list(raw.ch_names),
            "channel_types": raw.get_channel_types(),
            "annotations": [
                {
                    "onset_seconds": round(float(onset), 3),
                    "duration_seconds": round(float(duration), 3),
                    "description": description,
                    "interpretation": "undocumented",
                }
                for onset, duration, description in zip(
                    raw.annotations.onset,
                    raw.annotations.duration,
                    raw.annotations.description,
                )
            ],
            "signal": {
                "all_finite": bool(np.isfinite(data).all()),
                "min_volts": float(np.min(data)),
                "max_volts": float(np.max(data)),
                "channel_std_volts": {
                    name: float(np.std(data[index]))
                    for index, name in enumerate(raw.ch_names)
                },
            },
            "candidates": [event.to_dict() for event in events],
        })
    return {
        "reader": {"antio": antio.__version__, "mne": mne.__version__},
        "training_performed": False,
        "candidate_method": {
            "display_filter_hz": [0.5, 40.0],
            "frontal_band_hz": [0.5, 8.0],
            "temporal_band_hz": [20.0, 40.0],
            "envelope_window_seconds": 0.1,
            "threshold": "max(median + 5 scaled MAD, 98th percentile)",
            "merge_gap_seconds": 0.12,
            "candidate_only": True,
            "marker_codes_used_for_labels": False,
        },
        "wink_side_distinguishable": None,
        "wink_side_assessment": (
            "Not established: lateralized frontal activity is a review cue, not "
            "ground truth for left versus right wink."
        ),
        "records": records,
    }


def write_reports(report: dict[str, object]) -> tuple[Path, Path]:
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    json_path = REPORT_DIR / "candidate-events.json"
    markdown_path = REPORT_DIR / "candidate-events.md"
    json_path.write_text(json.dumps(report, indent=2), encoding="utf-8")

    lines = [
        "# ANT Neuro signal candidate review",
        "",
        "These are unlabelled signal excursions for human review, not confirmed "
        "gestures or training data. No model was trained. The original CNT files "
        "were read without modification.",
        "",
        "## Method",
        "",
        "- Reader: ANTIO/MNE.",
        "- Display signal: zero-phase 4th-order Butterworth bandpass, 0.5-40 Hz; "
        "original raw samples remain unchanged.",
        "- Candidate cues: frontal 0.5-8 Hz RMS energy, left/right frontal RMS "
        "asymmetry, and temporal 20-40 Hz RMS energy.",
        "- A 100 ms RMS envelope, robust/98th-percentile threshold, duration "
        "filter, and 120 ms gap merge generate review intervals.",
        "- Numeric event markers are displayed as metadata only. Marker 1001 is "
        "not interpreted as a gesture.",
        "",
        "## Candidate intervals",
        "",
        "| Recording | Start (s) | End (s) | Signal cues | Peak / threshold |",
        "|---|---:|---:|---|---:|",
    ]
    for record in report["records"]:
        candidates = record["candidates"]
        if not candidates:
            lines.append(f"| `{record['file']}` | - | - | None detected | - |")
        for event in candidates:
            cues = ", ".join(event["detectors"])
            lines.append(
                f"| `{record['file']}` | {event['start_seconds']:.3f} | "
                f"{event['end_seconds']:.3f} | {cues} | {event['peak_score']:.2f} |"
            )
    lines.extend([
        "",
        "The peak/threshold value is a detector score, not a probability or "
        "confidence that the interval contains a gesture. A candidate may be "
        "movement, noise, or another artifact.",
        "",
        "## Recording and marker notes",
        "",
    ])
    for record in report["records"]:
        markers = record["annotations"]
        marker_text = (
            "; ".join(
                f"{event['description']} at {event['onset_seconds']:.3f} s "
                "(meaning undocumented)"
                for event in markers
            )
            if markers else "no annotations"
        )
        lines.append(
            f"- `{record['file']}`: eeph {record['file_version']}, "
            f"{record['sampling_hz']:.0f} Hz, {record['samples']} samples, "
            f"{record['duration_seconds']:.3f} s, {len(record['channel_names'])} "
            f"EEG channels; {marker_text}."
        )
    lines.extend([
        "",
        "## Wink-side assessment",
        "",
        report["wink_side_assessment"],
        "The recordings have no dedicated EOG or EMG channels. Human review must "
        "assign left/right wink labels from the session or other known context; "
        "the detector does not infer a side.",
        "",
        "Review candidates in the local UI:",
        "",
        "```powershell",
        "python -m streamlit run ml/ant_neuro/annotation_app.py",
        "```",
        "",
        "Confirmed intervals are written to "
        "`ml/ant_neuro/annotations/gesture_annotations.csv`; candidate review "
        "decisions are resumable from the adjacent JSON state file.",
    ])
    markdown_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return json_path, markdown_path


def main() -> None:
    if not recording_paths():
        raise FileNotFoundError(f"No root-level .cnt recordings in {REPOSITORY_ROOT}")
    json_path, markdown_path = write_reports(inspect_recordings())
    print(f"Wrote {json_path.relative_to(REPOSITORY_ROOT)}")
    print(f"Wrote {markdown_path.relative_to(REPOSITORY_ROOT)}")


if __name__ == "__main__":
    main()
