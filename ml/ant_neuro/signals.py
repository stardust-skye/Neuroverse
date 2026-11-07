"""Read, filter, and find unlabelled candidate events in ANT Neuro CNT files."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from pathlib import Path

import numpy as np
from scipy.signal import butter, find_peaks, peak_prominences, sosfiltfilt

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
ANNOTATION_LABELS = (
    "NORMAL_BLINK",
    "LEFT_WINK",
    "RIGHT_WINK",
    "JAW_CLENCH",
    "REST",
    "UNKNOWN",
)


@dataclass(frozen=True)
class CandidateEvent:
    event_id: str
    start_seconds: float
    end_seconds: float
    detectors: tuple[str, ...]
    peak_score: float
    features: tuple[dict[str, object], ...]

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


def recording_paths() -> list[Path]:
    """Return repository-root CNT recordings without copying or modifying them."""
    return sorted(REPOSITORY_ROOT.glob("*.cnt"))


def read_ant_recording(path: Path):
    """Read an ANT Neuro CNT file through ANTIO/MNE, preloading only for analysis."""
    import antio

    if path.suffix.lower() != ".cnt":
        raise ValueError(f"Expected an ANT Neuro .cnt file, got: {path}")
    return antio.io.read_raw_ant(path, preload=True, verbose="ERROR")


def filtered_data(
    data: np.ndarray,
    sampling_hz: float,
    low_hz: float = 0.5,
    high_hz: float = 40.0,
) -> np.ndarray:
    """Return a zero-phase Butterworth bandpass copy in the source units (volts)."""
    if data.ndim != 2 or data.shape[1] < 16:
        raise ValueError("EEG data must have shape (channels, samples) and at least 16 samples.")
    if not 0 < low_hz < high_hz < sampling_hz / 2:
        raise ValueError("Filter cutoffs must satisfy 0 < low < high < Nyquist.")
    sos = butter(4, (low_hz, high_hz), btype="bandpass", fs=sampling_hz, output="sos")
    return sosfiltfilt(sos, data, axis=-1)


def _bandpass(data: np.ndarray, sampling_hz: float, low_hz: float, high_hz: float) -> np.ndarray:
    sos = butter(4, (low_hz, high_hz), btype="bandpass", fs=sampling_hz, output="sos")
    return sosfiltfilt(sos, data, axis=-1)


def _rms_envelope(data: np.ndarray, window_samples: int) -> np.ndarray:
    power = np.mean(np.square(data), axis=0)
    window = np.ones(window_samples, dtype=np.float64) / window_samples
    return np.sqrt(np.convolve(power, window, mode="same"))


def _threshold(envelope: np.ndarray) -> tuple[float, float]:
    median = float(np.median(envelope))
    mad = float(np.median(np.abs(envelope - median))) * 1.4826
    robust_threshold = median + 5.0 * mad
    upper_quantile = float(np.quantile(envelope, 0.98))
    threshold = max(robust_threshold, upper_quantile)
    if not np.isfinite(threshold) or threshold <= 0:
        threshold = float(np.finfo(np.float64).eps)
    return threshold, median


def _segments(
    envelope: np.ndarray,
    source_data: np.ndarray,
    sampling_hz: float,
    detector: str,
    channel_names: tuple[str, ...],
    band_hz: tuple[float, float],
    min_duration: float,
    max_duration: float,
    merge_gap: float = 0.12,
) -> list[dict[str, object]]:
    threshold, baseline = _threshold(envelope)
    active = envelope > threshold
    indices = np.flatnonzero(active)
    if not len(indices):
        return []

    peaks, _ = find_peaks(envelope)
    prominences = peak_prominences(envelope, peaks)[0] if len(peaks) else np.array([])
    split_points = np.flatnonzero(np.diff(indices) > max(1, int(merge_gap * sampling_hz))) + 1
    groups = np.split(indices, split_points)
    found = []
    for group in groups:
        start = int(group[0])
        end = int(group[-1]) + 1
        duration = (end - start) / sampling_hz
        if min_duration <= duration <= max_duration:
            peak = int(group[np.argmax(envelope[group])])
            peak_positions = np.flatnonzero((peaks >= start) & (peaks < end))
            if len(peak_positions):
                peak_position = peak_positions[np.argmax(envelope[peaks[peak_positions]])]
                prominence = float(prominences[peak_position])
            else:
                prominence = max(0.0, float(envelope[peak]) - baseline)
            local = envelope[max(0, start - int(sampling_hz)):min(len(envelope), end + int(sampling_hz))]
            local_baseline = float(np.median(local))
            found.append({
                "start_seconds": start / sampling_hz,
                "end_seconds": end / sampling_hz,
                "detector": detector,
                "peak_ratio": float(envelope[peak] / threshold),
                "peak_amplitude_uv": float(envelope[peak] * 1e6),
                "peak_prominence_uv": float(prominence * 1e6),
                "mean_energy_uv2": float(np.mean(np.square(envelope[group])) * 1e12),
                "mean_channel_variance_uv2": float(
                    np.mean(np.var(source_data[:, start:end], axis=1)) * 1e12
                ),
                "threshold_uv": float(threshold * 1e6),
                "local_baseline_uv": float(local_baseline * 1e6),
                "channels": list(channel_names),
                "band_hz": list(band_hz),
            })
    return found


def detect_candidates(raw) -> list[CandidateEvent]:
    """Detect signal excursions for review; output is not a gesture label."""
    sampling_hz = float(raw.info["sfreq"])
    data = raw.get_data()
    names = {name: index for index, name in enumerate(raw.ch_names)}
    ocular_names = ("Fp1", "Fp2", "F9", "F7", "F3", "Fz", "F4", "F8", "F10")
    left_names = ("Fp1", "F9", "F7", "F3")
    right_names = ("Fp2", "F10", "F8", "F4")
    temporal_names = ("T9", "T7", "T8", "T10")
    missing = set(ocular_names + temporal_names).difference(names)
    if missing:
        raise ValueError(f"Recording is missing expected EEG channels: {sorted(missing)}")

    low_band = _bandpass(data, sampling_hz, 0.5, 8.0)
    jaw_band = _bandpass(data, sampling_hz, 20.0, min(40.0, sampling_hz / 2 - 1))
    envelope_window = max(1, int(round(0.10 * sampling_hz)))

    ocular_data = low_band[[names[name] for name in ocular_names]]
    left_data = low_band[[names[name] for name in left_names]]
    right_data = low_band[[names[name] for name in right_names]]
    temporal_data = jaw_band[[names[name] for name in temporal_names]]
    lateralized_data = np.vstack((left_data, right_data))
    ocular = _rms_envelope(ocular_data, envelope_window)
    left = _rms_envelope(left_data, envelope_window)
    right = _rms_envelope(right_data, envelope_window)
    lateralized = np.abs(left - right)
    temporal_emg = _rms_envelope(temporal_data, envelope_window)

    detections = []
    detections.extend(_segments(
        ocular, ocular_data, sampling_hz, "frontal_low_frequency",
        ocular_names, (0.5, 8.0), 0.06, 1.5,
    ))
    detections.extend(_segments(
        lateralized, lateralized_data, sampling_hz, "frontal_lateralized",
        left_names + right_names, (0.5, 8.0), 0.06, 1.5,
    ))
    detections.extend(_segments(
        temporal_emg, temporal_data, sampling_hz, "temporal_high_frequency",
        temporal_names, (20.0, min(40.0, sampling_hz / 2 - 1)), 0.08, 2.0,
    ))
    detections.sort(key=lambda item: (item["start_seconds"], item["end_seconds"]))

    merged: list[dict[str, object]] = []
    for detection in detections:
        start = float(detection["start_seconds"])
        end = float(detection["end_seconds"])
        if merged and start <= float(merged[-1]["end_seconds"]) + 0.05:
            item = merged[-1]
            item["end_seconds"] = max(float(item["end_seconds"]), end)
            item["features"].append(detection)
            item["peak_score"] = max(
                float(item["peak_score"]), float(detection["peak_ratio"])
            )
        else:
            merged.append({
                "start_seconds": start,
                "end_seconds": end,
                "features": [detection],
                "peak_score": float(detection["peak_ratio"]),
            })

    return [
        CandidateEvent(
            event_id=f"candidate-{index:03d}",
            start_seconds=round(float(item["start_seconds"]), 3),
            end_seconds=round(float(item["end_seconds"]), 3),
            detectors=tuple(sorted({
                str(feature["detector"]) for feature in item["features"]
            })),
            peak_score=round(float(item["peak_score"]), 2),
            features=tuple({
                key: round(float(value), 3) if isinstance(value, float) else value
                for key, value in feature.items()
            } for feature in item["features"]),
        )
        for index, item in enumerate(merged, start=1)
    ]
