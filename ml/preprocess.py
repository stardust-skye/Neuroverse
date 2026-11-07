"""Stream N-back band-power data into labeled, non-overlapping feature windows."""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
import pandas as pd
import pyarrow.parquet as pq

from ml.workload import (
    EEG_FILE,
    MIN_VALID_POWER_FRACTION,
    POWER_SAMPLING_HZ,
    PROCESSED_FILE,
    TEST_TO_CLASS,
    WINDOW_SECONDS,
    band_power_columns,
    model_feature_names,
)


def add_model_features(frame: pd.DataFrame, power_columns: list[str]) -> pd.DataFrame:
    """Derive log powers and within-electrode relative powers from window means."""
    power = frame.loc[:, power_columns].clip(lower=0).astype("float64")
    features: dict[str, np.ndarray] = {}
    for column in power_columns:
        features[f"LOG_{column}"] = np.log1p(power[column]).to_numpy()
    for electrode in sorted({column.split(".")[1] for column in power_columns}):
        electrode_columns = [
            column for column in power_columns if column.split(".")[1] == electrode
        ]
        denominator = power[electrode_columns].sum(axis=1).replace(0, np.nan)
        for column in electrode_columns:
            relative_name = f"REL_{column[4:]}"
            features[relative_name] = (
                power[column] / denominator
            ).fillna(0.0).to_numpy()
    derived = pd.DataFrame(features, index=frame.index)
    return pd.concat([frame, derived], axis=1)


def build_windows(
    source: Path = EEG_FILE,
    destination: Path = PROCESSED_FILE,
    window_seconds: int = WINDOW_SECONDS,
    batch_size: int = 65_536,
    min_valid_samples: int | None = None,
) -> pd.DataFrame:
    """Build windows from the supplied N-back EEG parquet."""
    if not source.is_file():
        raise FileNotFoundError(f"EEG parquet not found: {source}")
    if window_seconds < 1:
        raise ValueError("window_seconds must be a positive integer.")
    if min_valid_samples is None:
        min_valid_samples = max(
            1, int(window_seconds * POWER_SAMPLING_HZ * MIN_VALID_POWER_FRACTION)
        )
    parquet = pq.ParquetFile(source)
    power_columns = band_power_columns(parquet.schema.names)
    required = ["subject", "test", "phase", "datetime", *power_columns]
    partials: list[pd.DataFrame] = []

    for batch in parquet.iter_batches(batch_size=batch_size, columns=required):
        frame = batch.to_pandas()
        frame = frame.loc[frame["phase"] == 2].copy()
        frame["test"] = pd.to_numeric(frame["test"], errors="coerce")
        frame = frame.loc[frame["test"].isin(TEST_TO_CLASS)].copy()
        if frame.empty:
            continue
        frame["window_start"] = frame["datetime"].dt.floor(f"{window_seconds}s")
        keys = ["subject", "test", "window_start"]
        grouped = frame.groupby(keys, observed=True)[power_columns].agg(["sum", "count"])
        grouped.columns = [f"{operation}::{name}" for name, operation in grouped.columns]
        partials.append(grouped.copy().reset_index())

    if not partials:
        raise ValueError("No phase-2 N-back task samples were found in the EEG parquet.")
    combined = pd.concat(partials, ignore_index=True).copy()
    sum_columns = [f"sum::{name}" for name in power_columns]
    count_columns = [f"count::{name}" for name in power_columns]
    combined = combined.groupby(
        ["subject", "test", "window_start"], observed=True, as_index=False
    )[sum_columns + count_columns].sum()
    counts = combined[count_columns].to_numpy(dtype=np.float64)
    valid = np.all(counts >= min_valid_samples, axis=1)
    combined = combined.loc[valid].copy()
    counts = counts[valid]
    sums = combined[sum_columns].to_numpy(dtype=np.float64)
    means = np.divide(sums, counts, out=np.full_like(sums, np.nan), where=counts > 0)
    finite_rows = np.isfinite(means).all(axis=1)
    combined = combined.loc[finite_rows].reset_index(drop=True)
    means = means[finite_rows]

    output = combined[["subject", "test", "window_start"]].copy()
    output["subject"] = output["subject"].astype(str)
    output["test"] = output["test"].astype("int64")
    output["workload_class"] = output["test"].map(TEST_TO_CLASS)
    output["window_seconds"] = int(window_seconds)
    power_frame = pd.DataFrame(means, columns=power_columns)
    output = pd.concat([output, power_frame], axis=1)
    output = add_model_features(output, power_columns)
    feature_columns = model_feature_names(power_columns)
    result = output[
        [
            "subject",
            "test",
            "workload_class",
            "window_start",
            "window_seconds",
            *power_columns,
            *feature_columns,
        ]
    ].sort_values(["subject", "test", "window_start"], ignore_index=True)
    destination.parent.mkdir(parents=True, exist_ok=True)
    result.to_parquet(destination, index=False)
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=EEG_FILE)
    parser.add_argument("--output", type=Path, default=PROCESSED_FILE)
    parser.add_argument("--window-seconds", type=int, default=WINDOW_SECONDS)
    args = parser.parse_args()
    windows = build_windows(args.source, args.output, args.window_seconds)
    print(
        f"Created {len(windows)} windows across {windows['subject'].nunique()} "
        f"participants and {windows['workload_class'].nunique()} task classes: {args.output}"
    )
