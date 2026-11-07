import unittest
from types import SimpleNamespace

import numpy as np

from ml.ant_neuro.signals import detect_candidates, filtered_data


CHANNELS = [
    "Fp1", "Fp2", "F9", "F7", "F3", "Fz", "F4", "F8", "F10", "T9", "T7",
    "C3", "C4", "T8", "T10", "P9", "P7", "P3", "Pz", "P4", "P8", "P10",
    "O1", "O2",
]


class SignalProcessingTests(unittest.TestCase):
    def test_filter_returns_new_data_and_preserves_input(self):
        sampling_hz = 500
        times = np.arange(5000) / sampling_hz
        source = np.tile(np.sin(2 * np.pi * 3 * times), (24, 1))
        original = source.copy()

        result = filtered_data(source, sampling_hz)

        self.assertFalse(np.shares_memory(result, source))
        np.testing.assert_array_equal(source, original)
        self.assertEqual(result.shape, source.shape)
        self.assertTrue(np.isfinite(result).all())

    def test_detector_finds_frontal_and_temporal_candidates_without_labels(self):
        sampling_hz = 500
        times = np.arange(5000) / sampling_hz
        rng = np.random.default_rng(42)
        data = rng.normal(0, 4e-6, (len(CHANNELS), len(times)))
        blink = 150e-6 * np.exp(-0.5 * ((times - 4.0) / 0.08) ** 2)
        jaw = 60e-6 * np.sin(2 * np.pi * 30 * times) * (
            (times >= 7.0) & (times <= 7.5)
        )
        for channel in ("Fp1", "Fp2", "F7", "F8"):
            data[CHANNELS.index(channel)] += blink
        for channel in ("T7", "T8", "T9", "T10"):
            data[CHANNELS.index(channel)] += jaw
        raw = SimpleNamespace(
            info={"sfreq": sampling_hz},
            ch_names=CHANNELS,
            get_data=lambda: data,
        )

        candidates = detect_candidates(raw)

        self.assertTrue(any(
            "frontal_low_frequency" in candidate.detectors
            and candidate.start_seconds < 4.0 < candidate.end_seconds
            for candidate in candidates
        ))
        self.assertTrue(any(
            "temporal_high_frequency" in candidate.detectors
            and candidate.start_seconds < 7.35 < candidate.end_seconds
            for candidate in candidates
        ))
        self.assertTrue(all(not hasattr(candidate, "label") for candidate in candidates))


if __name__ == "__main__":
    unittest.main()
