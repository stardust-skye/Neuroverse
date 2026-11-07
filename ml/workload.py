"""Shared workload labels, feature contract, and dataset paths."""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATASET_ROOT = ROOT / "workload_dataset"
EEG_FILE = DATASET_ROOT / "data_n_back_test" / "eeg" / "eeg.parquet"
PROCESSED_FILE = ROOT / "ml" / "data" / "processed" / "nback_windows.parquet"
MODEL_FILE = ROOT / "ml" / "models" / "workload_classifier.joblib"
METRICS_FILE = ROOT / "ml" / "reports" / "model_evaluation.json"
INSPECTION_FILE = ROOT / "ml" / "reports" / "dataset_inspection.json"

WINDOW_SECONDS = 10
POWER_SAMPLING_HZ = 8
MIN_VALID_POWER_FRACTION = 0.5
RANDOM_SEED = 42
TEST_TO_CLASS = {1: "low", 2: "moderate", 3: "high"}
CLASS_TO_TEST = {value: key for key, value in TEST_TO_CLASS.items()}
CLASS_NAMES = ["low", "moderate", "high"]
BANDS = ["Theta", "Alpha", "BetaL", "BetaH", "Gamma"]


def band_power_columns(parquet_columns: list[str]) -> list[str]:
    """Return the dataset's per-electrode Emotiv band-power features."""
    columns = [
        name
        for name in parquet_columns
        if name.startswith("POW.") and name.rsplit(".", 1)[-1] in BANDS
    ]
    if not columns:
        raise ValueError("No supported precomputed EEG band-power columns were found.")
    if len(columns) != 14 * len(BANDS):
        raise ValueError(
            f"Expected 14 electrodes × {len(BANDS)} bands, found {len(columns)} features."
        )
    return columns


def model_feature_names(power_columns: list[str]) -> list[str]:
    """Return the stable model feature order: log power then within-electrode ratios."""
    log_features = [f"LOG_{column}" for column in power_columns]
    relative_features = [f"REL_{column[4:]}" for column in power_columns]
    return log_features + relative_features
