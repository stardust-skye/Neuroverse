"""Local FastAPI service for recorded EEG replay and workload inference."""

from __future__ import annotations

from functools import lru_cache
from datetime import datetime

import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from ml.adaptation import AdaptiveEngine
from ml.inference import (
    InvalidFeaturesError,
    ModelNotAvailableError,
    load_bundle,
    predict_features,
)
from ml.workload import (
    CLASS_NAMES,
    METRICS_FILE,
    MODEL_FILE,
    PROCESSED_FILE,
    TEST_TO_CLASS,
)

app = FastAPI(title="NEURO-ADAPT local workload service", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:5173", "http://localhost:5173"],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)
REPLAY_HISTORY: list[dict] = []


class PredictionRequest(BaseModel):
    features: dict[str, float] = Field(min_length=1)


class ReplayRequest(BaseModel):
    subject: str = Field(min_length=1)
    test: int = Field(ge=1, le=3)


@lru_cache(maxsize=1)
def _bundle() -> dict:
    return load_bundle()


def _read_windows() -> pd.DataFrame:
    if not PROCESSED_FILE.is_file():
        raise HTTPException(
            status_code=503,
            detail="Processed EEG windows are missing. Run `python -m ml.preprocess` first.",
        )
    return pd.read_parquet(PROCESSED_FILE)


@app.get("/api/model/status")
def model_status() -> dict:
    metrics = None
    if METRICS_FILE.is_file():
        metrics = pd.read_json(METRICS_FILE, typ="series").to_dict()
    return {
        "model_available": MODEL_FILE.is_file(),
        "model_loaded": _bundle.cache_info().currsize > 0,
        "model_name": metrics.get("selected_model") if metrics else None,
        "task": "N-back task-condition classification",
        "labels": TEST_TO_CLASS,
        "evaluation": metrics.get("models", {}) if metrics else None,
        "dataset_windows_available": PROCESSED_FILE.is_file(),
        "input_source": "Recorded EEG Demo only; no live headset connection",
    }


@app.get("/api/workload/sessions")
def list_recorded_sessions() -> dict:
    frame = _read_windows()
    sessions = (
        frame.groupby(["subject", "test", "workload_class"], as_index=False)
        .size()
        .sort_values(["subject", "test"])
    )
    return {
        "sessions": [
            {
                "subject": str(row.subject),
                "test": int(row.test),
                "recorded_condition": str(row.workload_class),
                "windows": int(row["size"]),
            }
            for row in sessions.itertuples(index=False)
        ]
    }


@app.post("/api/workload/predict")
def predict(request: PredictionRequest) -> dict:
    try:
        result = predict_features(request.features, _bundle())
    except ModelNotAvailableError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    except InvalidFeaturesError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    return result


@app.post("/api/workload/replay")
def replay(request: ReplayRequest) -> dict:
    try:
        bundle = _bundle()
    except ModelNotAvailableError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    frame = _read_windows()
    selected = frame.loc[
        (frame["subject"].astype(str) == request.subject)
        & (frame["test"].astype(int) == request.test)
    ].sort_values("window_start")
    if selected.empty:
        raise HTTPException(status_code=404, detail="No processed recording matches that participant and task.")
    features = selected[bundle["feature_names"]].to_numpy(dtype=np.float64)
    if not np.isfinite(features).all():
        raise HTTPException(status_code=422, detail="The selected recording contains invalid feature values.")
    probabilities = bundle["model"].predict_proba(features)
    codes = bundle["model"].classes_
    engine = AdaptiveEngine()
    timeline = []
    start = pd.Timestamp(selected["window_start"].iloc[0])
    for index, row in enumerate(selected.itertuples(index=False)):
        probability_map = {
            CLASS_NAMES[int(code) - 1]: float(probability)
            for code, probability in zip(codes, probabilities[index], strict=True)
        }
        prediction = max(probability_map, key=probability_map.get)
        confidence = probability_map[prediction]
        adaptation = engine.update(prediction, confidence, index * int(row.window_seconds))
        timeline.append(
            {
                "window_start": pd.Timestamp(row.window_start).isoformat(),
                "workload_class": prediction,
                "confidence": confidence,
                "probabilities": probability_map,
                "adaptation": adaptation.as_dict(),
            }
        )
    result = {
        "source": "recorded_eeg_demo",
        "is_live": False,
        "participant": request.subject,
        "test": request.test,
        "recorded_condition": TEST_TO_CLASS[request.test],
        "condition_basis": "Dataset task condition, not a direct measurement of internal workload.",
        "model_name": bundle["selected_model"],
        "timeline": timeline,
    }
    REPLAY_HISTORY.insert(
        0,
        {
            "source": result["source"],
            "participant": request.subject,
            "test": request.test,
            "recorded_condition": result["recorded_condition"],
            "model_name": bundle["selected_model"],
            "windows": len(timeline),
            "predicted_class_counts": {
                name: sum(item["workload_class"] == name for item in timeline)
                for name in CLASS_NAMES
            },
            "last_adaptation": timeline[-1]["adaptation"],
            "completed_at": datetime.now().astimezone().isoformat(),
        },
    )
    del REPLAY_HISTORY[100:]
    return result


@app.get("/api/workload/history")
def workload_history(limit: int = 20) -> dict:
    if limit < 1 or limit > 100:
        raise HTTPException(status_code=422, detail="limit must be between 1 and 100.")
    return {"history": REPLAY_HISTORY[:limit]}
