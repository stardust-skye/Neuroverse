"""Voluntary nod (yes) / shake (no) detection from head-motion artifacts in EEG.

A nod swings forehead vs. occipital electrodes in opposite directions; a shake swings
left vs. right temporal electrodes. Detection only runs while a question is pending,
which keeps false confirmations rare.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy.signal import butter, sosfiltfilt

from ml.instinct.channels import (CHANNELS, HORIZONTAL_LEFT, HORIZONTAL_RIGHT,
                                  VERTICAL_BACK, VERTICAL_TOP, indices)

WINDOW_S = 1.6


def axes(data: np.ndarray, sfreq: float, channels=CHANNELS) -> tuple[np.ndarray, np.ndarray]:
    sos = butter(2, (0.3, 4.0), btype="bandpass", fs=sfreq, output="sos")
    low = sosfiltfilt(sos, data, axis=-1)
    vertical = low[indices(VERTICAL_TOP, channels)].mean(0) - low[indices(VERTICAL_BACK, channels)].mean(0)
    horizontal = low[indices(HORIZONTAL_LEFT, channels)].mean(0) - low[indices(HORIZONTAL_RIGHT, channels)].mean(0)
    return vertical, horizontal


@dataclass
class GestureModel:
    rest_v: float
    rest_h: float
    threshold: float = 8.0       # window variance relative to rest variance
    dominance: float = 1.8       # winning axis must exceed the other by this factor
    source: str = "default"

    @classmethod
    def from_rest(cls, rest: np.ndarray, sfreq: float, channels=CHANNELS, **kw) -> "GestureModel":
        v, h = axes(rest, sfreq, channels)
        return cls(rest_v=float(v.var()) + 1e-18, rest_h=float(h.var()) + 1e-18, **kw)

    def energies(self, window: np.ndarray, sfreq: float, channels=CHANNELS) -> tuple[float, float, bool]:
        v, h = axes(window, sfreq, channels)
        n = len(v) // 4
        core_v, core_h = v[n:-n], h[n:-n]          # ignore filter edges
        half = len(core_v) // 2
        ev, eh = core_v.var() / self.rest_v, core_h.var() / self.rest_h
        # Sustained motion in both halves rejects single blinks (one brief spike).
        sustained_v = min(core_v[:half].var(), core_v[half:].var()) / self.rest_v
        sustained_h = min(core_h[:half].var(), core_h[half:].var()) / self.rest_h
        sustained = max(sustained_v, sustained_h) > self.threshold / 4
        return float(ev), float(eh), bool(sustained)

    @staticmethod
    def _two_sided(signal: np.ndarray) -> bool:
        """Head motion swings both ways; a blink is a one-sided bump (plus small filter rebound)."""
        n = len(signal) // 4
        core = signal[n:-n]
        top, bottom = float(core.max()), float(-core.min())
        return min(top, bottom) >= 0.6 * max(top, bottom)

    def detect(self, window: np.ndarray, sfreq: float, channels=CHANNELS) -> dict | None:
        ev, eh, sustained = self.energies(window, sfreq, channels)
        if not sustained or max(ev, eh) < self.threshold:
            return None
        v, h = axes(window, sfreq, channels)
        if ev > self.dominance * eh and self._two_sided(v):
            return {"gesture": "nod", "strength": round(ev, 1)}
        if eh > self.dominance * ev and self._two_sided(h):
            return {"gesture": "shake", "strength": round(eh, 1)}
        return None

    def calibrate(self, nods: list[np.ndarray], shakes: list[np.ndarray], rests: list[np.ndarray],
                  sfreq: float, channels=CHANNELS) -> None:
        gesture_e = [max(self.energies(w, sfreq, channels)[:2]) for w in nods + shakes]
        rest_e = [max(self.energies(w, sfreq, channels)[:2]) for w in rests]
        if gesture_e:
            rest_hi = float(np.quantile(rest_e, 0.95)) if rest_e else 2.0
            self.threshold = float(np.sqrt(max(rest_hi, 1.5) * max(np.median(gesture_e), rest_hi * 1.5)))
            self.source = "calibrated"
