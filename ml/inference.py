"""Load the trained workload classifier and validate prediction requests."""

from __future__ import annotations

from typing import Any

import joblib
import numpy as np

from ml.workload import CLASS_NAMES, MODEL_FILE


class ModelNotAvailableError(RuntimeError):
    """Raised when inference is requested before a trained model exists."""


class InvalidFeaturesError(ValueError):
    """Raised when the supplied EEG features do not match the model contract."""


def load_bundle(path=MODEL_FILE) -> dict[str, Any]:
    if not path.is_file():
        raise ModelNotAvailableError(
            f"No trained workload model found at {path}. Run `python -m ml.train` first."
        )
    return joblib.load(path)


def predict_features(features: dict[str, float], bundle: dict[str, Any] | None = None) -> dict:
    bundle = bundle or load_bundle()
    names = bundle["feature_names"]
    missing = [name for name in names if name not in features]
    if missing:
        raise InvalidFeaturesError(f"Missing required EEG features: {missing[:8]}")
    try:
        vector = np.asarray([features[name] for name in names], dtype=np.float64)
    except (TypeError, ValueError) as error:
        raise InvalidFeaturesError("EEG feature values must be numeric.") from error
    if vector.shape != (len(names),) or not np.isfinite(vector).all():
        raise InvalidFeaturesError(
            f"Expected {len(names)} finite features in the trained feature order."
        )
    model = bundle["model"]
    probabilities = model.predict_proba(vector.reshape(1, -1))[0]
    class_codes = model.classes_
    mapped = {
        CLASS_NAMES[int(code) - 1]: float(probability)
        for code, probability in zip(class_codes, probabilities, strict=True)
    }
    predicted = max(mapped, key=mapped.get)
    return {
        "workload_class": predicted,
        "confidence": mapped[predicted],
        "probabilities": mapped,
    }
