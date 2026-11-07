"""Compare workload baselines using participant-independent cross-validation."""

from __future__ import annotations

import json
from datetime import datetime

import joblib
import numpy as np
import pandas as pd
import sklearn
from sklearn.ensemble import GradientBoostingClassifier, RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    accuracy_score,
    confusion_matrix,
    f1_score,
    precision_score,
    recall_score,
)
from sklearn.model_selection import StratifiedGroupKFold
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.svm import SVC

from ml.workload import (
    CLASS_NAMES,
    METRICS_FILE,
    MODEL_FILE,
    PROCESSED_FILE,
    RANDOM_SEED,
    TEST_TO_CLASS,
    ROOT,
    model_feature_names,
)


def metric_report(y_true: np.ndarray, y_pred: np.ndarray) -> dict:
    return {
        "accuracy": float(accuracy_score(y_true, y_pred)),
        "precision_macro": float(precision_score(y_true, y_pred, average="macro", zero_division=0)),
        "recall_macro": float(recall_score(y_true, y_pred, average="macro", zero_division=0)),
        "f1_macro": float(f1_score(y_true, y_pred, average="macro", zero_division=0)),
        "confusion_matrix": confusion_matrix(y_true, y_pred, labels=[1, 2, 3]).tolist(),
        "per_class": {
            name: {
                "precision": float(
                    precision_score(y_true, y_pred, labels=[code], average="macro", zero_division=0)
                ),
                "recall": float(
                    recall_score(y_true, y_pred, labels=[code], average="macro", zero_division=0)
                ),
                "f1": float(
                    f1_score(y_true, y_pred, labels=[code], average="macro", zero_division=0)
                ),
                "support": int(np.sum(y_true == code)),
            }
            for code, name in enumerate(CLASS_NAMES, start=1)
        },
    }


def build_models() -> dict:
    return {
        "logistic_regression": make_pipeline(
            StandardScaler(),
            LogisticRegression(
                class_weight="balanced",
                max_iter=1500,
                random_state=RANDOM_SEED,
            ),
        ),
        "random_forest": RandomForestClassifier(
            n_estimators=180,
            min_samples_leaf=2,
            class_weight="balanced_subsample",
            n_jobs=-1,
            random_state=RANDOM_SEED,
        ),
        "support_vector_machine": make_pipeline(
            StandardScaler(),
            SVC(
                probability=True,
                class_weight="balanced",
                random_state=RANDOM_SEED,
            ),
        ),
        "gradient_boosting": GradientBoostingClassifier(
            n_estimators=100,
            learning_rate=0.05,
            max_depth=2,
            random_state=RANDOM_SEED,
        ),
    }


def train() -> dict:
    if not PROCESSED_FILE.is_file():
        raise FileNotFoundError(
            f"Processed feature windows not found at {PROCESSED_FILE}. "
            "Run `python -m ml.preprocess` first."
        )
    frame = pd.read_parquet(PROCESSED_FILE)
    source_columns = frame.columns.tolist()
    power_columns = [name for name in source_columns if name.startswith("POW.")]
    feature_columns = model_feature_names(power_columns)
    if not feature_columns or any(name not in frame for name in feature_columns):
        raise ValueError("Processed parquet does not match the documented feature contract.")
    x = frame[feature_columns].to_numpy(dtype=np.float64)
    y = frame["test"].to_numpy(dtype=np.int64)
    groups = frame["subject"].astype(str).to_numpy()
    if not np.isfinite(x).all():
        raise ValueError("Processed feature matrix contains non-finite values.")
    if set(np.unique(y)) != {1, 2, 3}:
        raise ValueError("Training requires supported N-back labels 1, 2 and 3.")
    if len(np.unique(groups)) < 5:
        raise ValueError("At least five distinct participants are needed for grouped CV.")

    splitter = StratifiedGroupKFold(n_splits=5, shuffle=True, random_state=RANDOM_SEED)
    folds = list(splitter.split(x, y, groups))
    model_results = {}
    out_of_fold_results = {}
    models = build_models()
    for name, model in models.items():
        out_of_fold = np.full(y.shape, -1, dtype=np.int64)
        probabilities = np.full((len(y), len(CLASS_NAMES)), np.nan, dtype=np.float64)
        test_participants = []
        for train_indices, test_indices in folds:
            model.fit(x[train_indices], y[train_indices])
            out_of_fold[test_indices] = model.predict(x[test_indices])
            fold_probabilities = model.predict_proba(x[test_indices])
            for column, code in enumerate(model.classes_):
                probabilities[test_indices, int(code) - 1] = fold_probabilities[:, column]
            test_participants.append(sorted(set(groups[test_indices])))
        if (out_of_fold < 0).any() or not np.isfinite(probabilities).all():
            raise RuntimeError(f"Cross-validation did not predict every row for {name}.")
        model_results[name] = {
            **metric_report(y, out_of_fold),
            "test_participant_counts_per_fold": [len(group) for group in test_participants],
        }
        out_of_fold_results[name] = (out_of_fold, probabilities)

    selected_name = max(
        model_results,
        key=lambda name: (
            model_results[name]["f1_macro"],
            model_results[name]["accuracy"],
        ),
    )
    selected_model = models[selected_name]
    selected_model.fit(x, y)
    selected_predictions, selected_probabilities = out_of_fold_results[selected_name]
    oof = frame[["subject", "test", "workload_class", "window_start"]].copy()
    oof["predicted_code"] = selected_predictions
    oof["predicted_class"] = [TEST_TO_CLASS[int(code)] for code in selected_predictions]
    oof["model_score"] = selected_probabilities.max(axis=1)
    for index, name in enumerate(CLASS_NAMES):
        oof[f"probability_{name}"] = selected_probabilities[:, index]
    heldout_path = ROOT / "ml" / "reports" / "heldout_predictions.parquet"
    heldout_path.parent.mkdir(parents=True, exist_ok=True)
    oof.to_parquet(heldout_path, index=False)
    bundle = {
        "model": selected_model,
        "feature_names": feature_columns,
        "class_names": CLASS_NAMES,
        "test_to_class": TEST_TO_CLASS,
        "selected_model": selected_name,
        "random_seed": RANDOM_SEED,
        "window_seconds": int(frame["window_seconds"].iloc[0]),
        "evaluation": "5-fold StratifiedGroupKFold; participant held out per fold",
    }
    MODEL_FILE.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(bundle, MODEL_FILE)
    report = {
        "task": "N-back experimental task-condition classification",
        "label_mapping": {str(key): value for key, value in TEST_TO_CLASS.items()},
        "label_caveat": (
            "Classes are task-condition labels from the dataset documentation, "
            "not direct measurements of an individual's internal workload. "
            "Phase 2 is presumed to be the active task interval based on timing; "
            "the included README does not define the numeric phase codes."
        ),
        "participants": int(len(np.unique(groups))),
        "windows": int(len(frame)),
        "class_counts": {
            TEST_TO_CLASS[code]: int(np.sum(y == code)) for code in (1, 2, 3)
        },
        "feature_count": len(feature_columns),
        "window_seconds": int(frame["window_seconds"].iloc[0]),
        "validation": "5-fold StratifiedGroupKFold grouped by participant",
        "random_seed": RANDOM_SEED,
        "scikit_learn_version": sklearn.__version__,
        "models": model_results,
        "selected_model": selected_name,
        "saved_model": str(MODEL_FILE),
        "heldout_predictions": str(heldout_path),
        "trained_at": datetime.now().astimezone().isoformat(),
    }
    METRICS_FILE.parent.mkdir(parents=True, exist_ok=True)
    METRICS_FILE.write_text(json.dumps(report, indent=2), encoding="utf-8")
    return report


if __name__ == "__main__":
    print(json.dumps(train(), indent=2))
