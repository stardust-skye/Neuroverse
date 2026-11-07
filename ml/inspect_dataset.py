"""Inspect dataset metadata without modifying or copying source recordings."""

from __future__ import annotations

import json
from collections import defaultdict
from datetime import datetime
from pathlib import Path

import numpy as np
import pyarrow.parquet as pq

from ml.workload import DATASET_ROOT, EEG_FILE, INSPECTION_FILE, TEST_TO_CLASS, band_power_columns


def inspect() -> dict:
    if not DATASET_ROOT.is_dir():
        raise FileNotFoundError(f"Dataset folder not found: {DATASET_ROOT}")
    if not EEG_FILE.is_file():
        raise FileNotFoundError(f"N-back EEG recording not found: {EEG_FILE}")

    parquet = pq.ParquetFile(EEG_FILE)
    names = parquet.schema.names
    powers = band_power_columns(names)
    raw_channels = [
        name.removeprefix("EEG.")
        for name in names
        if name.startswith("EEG.")
        and name.removeprefix("EEG.") in {
            "AF3", "F7", "F3", "FC5", "T7", "P7", "O1",
            "O2", "P8", "T8", "FC6", "F4", "F8", "AF4",
        }
    ]
    sessions: dict[tuple[str, int, int], dict] = defaultdict(
        lambda: {"rows": 0, "start": None, "end": None}
    )
    sample_deltas: list[float] = []
    selected = ["subject", "test", "phase", "datetime"]
    for batch in parquet.iter_batches(batch_size=100_000, columns=selected):
        frame = batch.to_pandas()
        frame["test"] = frame["test"].astype("int64")
        for key, group in frame.groupby(["subject", "test", "phase"], observed=True):
            entry = sessions[(str(key[0]), int(key[1]), int(key[2]))]
            entry["rows"] += len(group)
            start, end = group["datetime"].min(), group["datetime"].max()
            entry["start"] = start if entry["start"] is None else min(entry["start"], start)
            entry["end"] = end if entry["end"] is None else max(entry["end"], end)
        if not sample_deltas:
            timestamps = frame.loc[
                (frame["test"] == 1) & (frame["phase"] == 2), "datetime"
            ].dropna()
            if len(timestamps) > 1:
                deltas = timestamps.diff().dt.total_seconds().to_numpy()
                sample_deltas.extend(
                    float(delta) for delta in deltas if np.isfinite(delta) and delta > 0
                )
    task_sessions = [
        {
            "participant": subject,
            "test": test,
            "class": TEST_TO_CLASS.get(test, "unknown"),
            "phase": phase,
            "rows": data["rows"],
            "start": data["start"].isoformat() if data["start"] else None,
            "end": data["end"].isoformat() if data["end"] else None,
        }
        for (subject, test, phase), data in sorted(sessions.items())
    ]
    active_sessions = [item for item in task_sessions if item["phase"] == 2]
    sampling_hz = 1 / float(np.median(sample_deltas)) if sample_deltas else None
    dataset_files = [path for path in DATASET_ROOT.rglob("*") if path.is_file()]
    related_experiments = {
        "n_back": {
            "participants_documented": 16,
            "recordings_documented": 48,
            "task_conditions": TEST_TO_CLASS,
            "performance_records": str(
                DATASET_ROOT / "data_n_back_test" / "game_performance" / "game_scores.parquet"
            ),
            "subjective_tlx_records": str(
                DATASET_ROOT / "data_n_back_test" / "subjective_performance" / "tlx_answers.parquet"
            ),
        },
        "heat_the_chair": {
            "participants_documented": 17,
            "recordings_documented": 34,
            "task_conditions": {
                "without interruptions": "low workload condition",
                "with interruptions": "moderate workload condition",
            },
            "eeg_file": str(
                DATASET_ROOT / "data_heat_the_chair" / "eeg" / "eeg.parquet"
            ),
        },
        "flight_simulator": {
            "participants_documented": 2,
            "missions": {
                "1": "easy",
                "2": "medium",
                "3": "hard",
                "4": "medium",
                "5": "medium",
            },
            "annotations": str(
                DATASET_ROOT / "data_flight_simulator" / "perceived_difficulty"
            ),
        },
    }
    result = {
        "dataset_root": str(DATASET_ROOT),
        "dataset_documentation": str(DATASET_ROOT / "README.txt"),
        "task": "N-back task-condition classification (not a clinical assessment)",
        "source_file": str(EEG_FILE),
        "file_bytes": EEG_FILE.stat().st_size,
        "dataset_file_count": len(dataset_files),
        "dataset_total_bytes": sum(path.stat().st_size for path in dataset_files),
        "experiments_documented": related_experiments,
        "rows": parquet.metadata.num_rows,
        "participants": len({item["participant"] for item in active_sessions}),
        "active_recordings": len(active_sessions),
        "phase_recording_counts": {
            str(phase): sum(item["phase"] == phase for item in task_sessions)
            for phase in sorted({item["phase"] for item in task_sessions})
        },
        "channels": raw_channels,
        "precomputed_band_power_features": powers,
        "sampling_rate_hz_estimate": sampling_hz,
        "sampling_rate_method": "Median positive datetime interval from streamed EEG rows",
        "band_power_update_rate_hz": 8,
        "band_power_rate_basis": (
            "The original dataset processing repository declares PSF=8 Hz; "
            "raw EEG sampling is declared as 128 Hz."
        ),
        "label_mapping": {
            str(test): label for test, label in TEST_TO_CLASS.items()
        },
        "label_basis": {
            "1": "Position 1-back task condition, documented low workload",
            "2": "Arithmetic 1-back task condition, documented medium workload",
            "3": "Dual arithmetic 2-back task condition, documented high workload",
        },
        "label_interpretation": (
            "Experimental task-condition labels, not direct measurements of an "
            "individual's internal workload."
        ),
        "limitations": [
            "Emotiv EPOC X 14-channel recordings only; no ANT Neuro data are present.",
            "Band-power units are not specified in the dataset documentation.",
            "The included README does not define numeric phase IDs; phase 2 is used as the presumed active task interval based on its timing and must be confirmed against the original protocol.",
            "Subjective TLX answers are session-level assessments, not time-aligned labels.",
        ],
        "inspected_at": datetime.now().astimezone().isoformat(),
    }
    INSPECTION_FILE.parent.mkdir(parents=True, exist_ok=True)
    INSPECTION_FILE.write_text(json.dumps(result, indent=2), encoding="utf-8")
    return result


if __name__ == "__main__":
    report = inspect()
    print(json.dumps({key: value for key, value in report.items() if key != "sessions"}, indent=2))
