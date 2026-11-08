"""Fit a per-wearer profile from calibration markers recorded in the ring buffer.

Protocol (driven by the app, ~3 min): 30 s rest; 40 cursor trials where the cursor
moves the wrong way 25% of the time (ErrP); 8 cued frowns; 6 cued nods; 6 cued shakes.
"""

from __future__ import annotations

from pathlib import Path

import joblib
import numpy as np
from sklearn.model_selection import StratifiedKFold, cross_val_score

from ml.instinct.gestures import WINDOW_S, GestureModel
from ml.instinct.reaction import (POST_S, PRE_S, ReactionModel, RestStats, errp_features,
                                  fit_errp, frown_ratio, frown_threshold)

PROFILES = Path(__file__).resolve().parent / "profiles"


def fit_profile(buffer, markers: list[dict], channels, sfreq: float) -> tuple[ReactionModel, GestureModel, dict]:
    starts = [m["t"] for m in markers if m["kind"] == "rest_start"]
    ends = [m["t"] for m in markers if m["kind"] == "rest_end"]
    if not starts or not ends:
        raise ValueError("Calibration needs a rest segment.")
    rest = buffer.window(starts[-1], ends[-1])
    if rest is None or rest.shape[1] < 10 * sfreq:
        raise ValueError("Rest segment is missing or shorter than 10 s.")
    rest_stats = RestStats.from_rest(rest, sfreq, channels)

    def epoch(t):
        return buffer.window(t - PRE_S, t + POST_S)

    trials = [(epoch(m["t"]), int(m["label"])) for m in markers if m["kind"] == "trial"]
    trials = [(e, y) for e, y in trials if e is not None]
    metrics: dict = {"trials": len(trials)}
    lda = None
    if trials and sum(y for _, y in trials) >= 6 and sum(1 - y for _, y in trials) >= 6:
        X = np.stack([e for e, _ in trials])
        y = np.array([y for _, y in trials])
        lda = fit_errp(X, y, sfreq, rest_stats, channels)
        feats = np.stack([errp_features(e, sfreq, rest_stats, channels) for e in X])
        folds = min(5, int(y.sum()), int((1 - y).sum()))
        from sklearn.discriminant_analysis import LinearDiscriminantAnalysis
        cv = cross_val_score(LinearDiscriminantAnalysis(solver="lsqr", shrinkage="auto", priors=[0.5, 0.5]),
                             feats, y, cv=StratifiedKFold(folds, shuffle=True, random_state=0),
                             scoring="balanced_accuracy")
        metrics["errp_cv_balanced_accuracy"] = round(float(cv.mean()), 3)

    correct_ratios = [frown_ratio(e, sfreq, rest_stats, channels) for e, y in trials if y == 0]
    frown_ratios = [frown_ratio(e, sfreq, rest_stats, channels)
                    for e in (epoch(m["t"]) for m in markers if m["kind"] == "frown") if e is not None]
    threshold = frown_threshold(correct_ratios, frown_ratios)
    metrics["frowns"] = len(frown_ratios)
    metrics["frown_threshold"] = round(threshold, 2)
    reaction = ReactionModel(rest=rest_stats, lda=lda, frown_threshold=threshold,
                             source="calibrated" if lda is not None else "calibrated-frown-only", metrics=metrics)

    def gesture_window(t):
        return buffer.window(t + 0.1, t + 0.1 + WINDOW_S)

    nods = [w for w in (gesture_window(m["t"]) for m in markers if m["kind"] == "nod") if w is not None]
    shakes = [w for w in (gesture_window(m["t"]) for m in markers if m["kind"] == "shake") if w is not None]
    step = int(WINDOW_S * sfreq)
    rest_windows = [rest[:, s:s + step] for s in range(0, rest.shape[1] - step, step)]
    gestures = GestureModel.from_rest(rest, sfreq, channels)
    gestures.calibrate(nods, shakes, rest_windows, sfreq, channels)
    hits = sum(bool((d := gestures.detect(w, sfreq, channels)) and d["gesture"] == "nod") for w in nods)
    hits += sum(bool((d := gestures.detect(w, sfreq, channels)) and d["gesture"] == "shake") for w in shakes)
    false = sum(bool(gestures.detect(w, sfreq, channels)) for w in rest_windows)
    metrics.update({"gesture_hits": f"{hits}/{len(nods) + len(shakes)}",
                    "gesture_false_on_rest": f"{false}/{len(rest_windows)}"})
    return reaction, gestures, metrics


def save(user: str, reaction: ReactionModel, gestures: GestureModel) -> Path:
    PROFILES.mkdir(exist_ok=True)
    path = PROFILES / f"{user.replace('@', '_at_')}.joblib"
    joblib.dump({"reaction": reaction, "gestures": gestures}, path)
    return path


def load(user: str):
    path = PROFILES / f"{user.replace('@', '_at_')}.joblib"
    return joblib.load(path) if path.is_file() else None
