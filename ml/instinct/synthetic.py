"""Synthetic 24-channel EEG with injectable reactions and gestures (volts).

Used by tests and by the mock stream so the full demo runs without hardware.
These waveforms are stylised textbook shapes, not recordings of a person.
"""

from __future__ import annotations

import numpy as np
from scipy.signal import butter, lfilter, sosfilt

from ml.instinct.channels import CHANNELS, INDEX

UV = 1e-6
_PINK_B = np.array([0.049922035, -0.095993537, 0.050612699, -0.004408786])
_PINK_A = np.array([1.0, -2.494956002, 2.017265875, -0.522189400])


def _weights(mapping: dict[str, float]) -> np.ndarray:
    weights = np.zeros(len(CHANNELS))
    for name, value in mapping.items():
        weights[INDEX[name]] = value
    return weights


def errp_waveform(sfreq: float, amplitude_uv: float = 9.0, delay_s: float = 0.0) -> np.ndarray:
    """Negativity ~250 ms then positivity ~350 ms after onset, fronto-central."""
    t = np.arange(int(1.0 * sfreq)) / sfreq - delay_s
    shape = -0.8 * np.exp(-((t - 0.25) ** 2) / (2 * 0.035**2)) + np.exp(-((t - 0.36) ** 2) / (2 * 0.06**2))
    weights = _weights({"Fz": 1.0, "F3": 0.7, "F4": 0.7, "C3": 0.8, "C4": 0.8, "Pz": 0.6,
                        "P3": 0.4, "P4": 0.4, "F7": 0.2, "F8": 0.2})
    return np.outer(weights, shape) * amplitude_uv * UV


def frown_waveform(sfreq: float, amplitude_uv: float = 25.0, rng=None) -> np.ndarray:
    """Broadband muscle burst on forehead channels, 0.3-0.9 s after onset."""
    rng = rng or np.random.default_rng()
    n = int(1.2 * sfreq)
    high = min(100.0, sfreq / 2 - 5)
    sos = butter(4, (25.0, high), btype="bandpass", fs=sfreq, output="sos")
    burst = sosfilt(sos, rng.standard_normal((len(CHANNELS), n)), axis=-1)
    t = np.arange(n) / sfreq
    envelope = np.clip((t - 0.3) / 0.08, 0, 1) * np.clip((0.9 - t) / 0.08, 0, 1)
    weights = _weights({"Fp1": 1.0, "Fp2": 1.0, "F9": 0.7, "F10": 0.7, "F7": 0.4, "F8": 0.4, "Fz": 0.2})
    burst = burst / (burst.std() + 1e-12)
    return burst * envelope * weights[:, None] * amplitude_uv * UV


def _motion(sfreq: float, pattern: dict[str, float], amplitude_uv: float) -> np.ndarray:
    t = np.arange(int(1.4 * sfreq)) / sfreq
    shape = np.sin(2 * np.pi * 1.5 * t) * np.sin(np.pi * t / t[-1])
    return np.outer(_weights(pattern), shape) * amplitude_uv * UV


def nod_waveform(sfreq: float, amplitude_uv: float = 60.0) -> np.ndarray:
    return _motion(sfreq, {"Fp1": 1.0, "Fp2": 1.0, "Fz": 0.5, "F3": 0.5, "F4": 0.5,
                           "O1": -0.9, "O2": -0.9, "P3": -0.4, "P4": -0.4, "Pz": -0.4}, amplitude_uv)


def shake_waveform(sfreq: float, amplitude_uv: float = 60.0) -> np.ndarray:
    return _motion(sfreq, {"F7": 1.0, "T7": 1.0, "F9": 0.9, "T9": 0.9, "P7": 0.4,
                           "F8": -1.0, "T8": -1.0, "F10": -0.9, "T10": -0.9, "P8": -0.4}, amplitude_uv)


class BackgroundEEG:
    """Stateful pink noise + occipital alpha, generated block by block without seams."""

    def __init__(self, sfreq: float = 500.0, seed: int | None = None, noise_uv: float = 8.0):
        self.sfreq = sfreq
        self.rng = np.random.default_rng(seed)
        self.noise_uv = noise_uv
        self._zi = np.zeros((len(CHANNELS), len(_PINK_A) - 1))
        self._phase = self.rng.uniform(0, 2 * np.pi)
        self._alpha = _weights({"O1": 1.0, "O2": 1.0, "P7": 0.6, "P8": 0.6, "Pz": 0.6,
                                "P3": 0.5, "P4": 0.5, "P9": 0.4, "P10": 0.4})

    def generate(self, n: int) -> np.ndarray:
        if n <= 0:
            return np.zeros((len(CHANNELS), 0))
        white = self.rng.standard_normal((len(CHANNELS), n))
        pink, self._zi = lfilter(_PINK_B, _PINK_A, white, axis=-1, zi=self._zi)
        phases = self._phase + 2 * np.pi * 10.0 * np.arange(1, n + 1) / self.sfreq
        self._phase = float(phases[-1] % (2 * np.pi))
        alpha = np.outer(self._alpha, np.sin(phases)) * 4.0
        return (pink * self.noise_uv * 3.0 + alpha) * UV


def epoch_dataset(sfreq: float = 500.0, n_error: int = 40, n_correct: int = 120, seed: int = 0,
                  pre_s: float = 1.0, post_s: float = 1.6, frown_share: float = 0.0):
    """Return (epochs[n, ch, samples], labels) with onset at `pre_s` seconds."""
    rng = np.random.default_rng(seed)
    background = BackgroundEEG(sfreq, seed=seed)
    n = int((pre_s + post_s) * sfreq)
    onset = int(pre_s * sfreq)
    epochs, labels = [], []
    for label in [1] * n_error + [0] * n_correct:
        data = background.generate(n)
        if label:
            wave = errp_waveform(sfreq, amplitude_uv=rng.uniform(5, 11), delay_s=rng.uniform(0, 0.3))
            data[:, onset:onset + wave.shape[1]] += wave
            if rng.random() < frown_share:
                frown = frown_waveform(sfreq, rng=rng)
                data[:, onset:onset + frown.shape[1]] += frown
        epochs.append(data)
        labels.append(label)
    order = rng.permutation(len(labels))
    return np.asarray(epochs)[order], np.asarray(labels)[order]
