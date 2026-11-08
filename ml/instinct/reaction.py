"""Involuntary-reaction score for one revealed text chunk.

Two cues, both time-locked to the chunk onset:
- error-related potential (ErrP): 1-10 Hz mean amplitudes at fronto-central/parietal sites;
- micro-frown: 25-100 Hz forehead muscle power relative to the wearer's rest baseline.
All features are divided by rest statistics, so the model is independent of stream units.
A single reading is noisy; the app always asks the wearer to confirm with a nod or shake.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
from scipy.signal import butter, sosfiltfilt
from sklearn.discriminant_analysis import LinearDiscriminantAnalysis

from ml.instinct.channels import CHANNELS, ERRP, FROWN, indices

PRE_S = 1.0          # data kept before onset (filter padding + baseline)
POST_S = 1.6         # data needed after onset before scoring
ERRP_WINDOWS = ((0.20, 0.30), (0.30, 0.45), (0.45, 0.70), (0.70, 1.00))
FROWN_WINDOW = (0.20, 1.50)


def _sos(sfreq, low, high):
    high = min(high, sfreq / 2 - 5)
    return butter(2 if high < 20 else 4, (low, high), btype="bandpass", fs=sfreq, output="sos")


@dataclass
class RestStats:
    errp_scale: np.ndarray        # std of 1-10 Hz rest signal, per ERRP channel
    frown_rms: float              # median windowed 25-100 Hz RMS at rest

    @classmethod
    def from_rest(cls, rest: np.ndarray, sfreq: float, channels=CHANNELS) -> "RestStats":
        low = sosfiltfilt(_sos(sfreq, 1.0, 10.0), rest[indices(ERRP, channels)], axis=-1)
        if not set(FROWN) <= set(channels):          # e.g. public datasets restricted to ERRP channels
            return cls(errp_scale=low.std(axis=1) + 1e-12, frown_rms=float("nan"))
        high = sosfiltfilt(_sos(sfreq, 25.0, 100.0), rest[indices(FROWN, channels)], axis=-1)
        win = int(1.3 * sfreq)
        rms = [np.sqrt(np.mean(high[:, s:s + win] ** 2)) for s in range(0, high.shape[1] - win, win // 2)]
        return cls(errp_scale=low.std(axis=1) + 1e-12, frown_rms=float(np.median(rms)) + 1e-15)


def errp_features(epoch: np.ndarray, sfreq: float, rest: RestStats, channels=CHANNELS) -> np.ndarray:
    data = sosfiltfilt(_sos(sfreq, 1.0, 10.0), epoch[indices(ERRP, channels)], axis=-1)
    onset = int(PRE_S * sfreq)
    data = data - data[:, onset - int(0.2 * sfreq):onset].mean(axis=1, keepdims=True)
    data = data / rest.errp_scale[:, None]
    feats = [data[:, onset + int(a * sfreq):onset + int(b * sfreq)].mean(axis=1) for a, b in ERRP_WINDOWS]
    return np.concatenate(feats)


def frown_ratio(epoch: np.ndarray, sfreq: float, rest: RestStats, channels=CHANNELS) -> float:
    data = sosfiltfilt(_sos(sfreq, 25.0, 100.0), epoch[indices(FROWN, channels)], axis=-1)
    onset = int(PRE_S * sfreq)
    a, b = (onset + int(t * sfreq) for t in FROWN_WINDOW)
    return float(np.sqrt(np.mean(data[:, a:b] ** 2)) / rest.frown_rms)


@dataclass
class ReactionModel:
    rest: RestStats
    lda: LinearDiscriminantAnalysis | None
    frown_threshold: float = 2.5          # ratio to rest RMS
    source: str = "synthetic-default"
    metrics: dict = field(default_factory=dict)

    def score(self, epoch: np.ndarray, sfreq: float, channels=CHANNELS) -> dict:
        p_errp = 0.0
        if self.lda is not None:
            p_errp = float(self.lda.predict_proba(errp_features(epoch, sfreq, self.rest, channels)[None])[0, 1])
        ratio = frown_ratio(epoch, sfreq, self.rest, channels)
        p_frown = float(1 / (1 + np.exp(-4.0 * (np.log(ratio) - np.log(self.frown_threshold)))))
        score = max(p_errp, p_frown)
        return {"score": round(score, 3), "errp": round(p_errp, 3), "frown": round(p_frown, 3),
                "frown_ratio": round(ratio, 2), "flagged": score >= 0.5}


def fit_errp(epochs: np.ndarray, labels: np.ndarray, sfreq: float, rest: RestStats,
             channels=CHANNELS) -> LinearDiscriminantAnalysis:
    X = np.stack([errp_features(e, sfreq, rest, channels) for e in epochs])
    lda = LinearDiscriminantAnalysis(solver="lsqr", shrinkage="auto", priors=[0.5, 0.5])
    return lda.fit(X, labels)


def frown_threshold(rest_ratios, frown_ratios) -> float:
    """Geometric midpoint between typical rest and typical frown ratios."""
    rest_hi = float(np.quantile(rest_ratios, 0.9)) if len(rest_ratios) else 1.5
    frown_lo = float(np.median(frown_ratios)) if len(frown_ratios) else 4.0
    return float(np.sqrt(max(rest_hi, 1.05) * max(frown_lo, rest_hi * 1.2)))


def default_model(sfreq: float = 500.0) -> ReactionModel:
    """Model fitted on synthetic data so the mock demo works before calibration."""
    from ml.instinct.synthetic import BackgroundEEG, epoch_dataset

    rest = RestStats.from_rest(BackgroundEEG(sfreq, seed=7).generate(int(30 * sfreq)), sfreq)
    epochs, labels = epoch_dataset(sfreq, seed=1)
    return ReactionModel(rest=rest, lda=fit_errp(epochs, labels, sfreq, rest))
