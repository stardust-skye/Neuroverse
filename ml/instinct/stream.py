"""EEG sources (live LSL, synthetic mock, CNT replay), a timestamped ring buffer, and a recorder."""

from __future__ import annotations

import json
import time
from pathlib import Path

import numpy as np

from ml.instinct.channels import CHANNELS
from ml.instinct.synthetic import BackgroundEEG

RECORDINGS = Path(__file__).resolve().parent / "recordings"


def clock() -> float:
    try:
        from pylsl import local_clock
        return float(local_clock())
    except Exception:  # pylsl missing: fall back to a monotonic clock
        return time.monotonic()


class RingBuffer:
    def __init__(self, n_channels: int, sfreq: float, seconds: float = 240.0):
        self.sfreq = sfreq
        self.size = int(seconds * sfreq)
        self.data = np.zeros((n_channels, self.size), dtype=np.float32)
        self.times = np.full(self.size, -np.inf)
        self.count = 0

    def push(self, data: np.ndarray, times: np.ndarray) -> None:
        n = data.shape[1]
        if n == 0:
            return
        if n > self.size:
            data, times, n = data[:, -self.size:], times[-self.size:], self.size
        idx = (self.count + np.arange(n)) % self.size
        self.data[:, idx] = data
        self.times[idx] = times
        self.count += n

    @property
    def latest(self) -> float:
        return float(self.times[(self.count - 1) % self.size]) if self.count else -np.inf

    def window(self, start: float, end: float) -> np.ndarray | None:
        """Samples with start <= t < end in chronological order, or None if not fully buffered."""
        n = min(self.count, self.size)
        if n == 0 or self.latest < end:
            return None
        order = (self.count - n + np.arange(n)) % self.size
        times = self.times[order]
        if times[0] > start:
            return None
        mask = (times >= start) & (times < end)
        return self.data[:, order[mask]].astype(np.float64)

    def last(self, seconds: float) -> np.ndarray | None:
        n = int(seconds * self.sfreq)
        if self.count < n:
            return None
        idx = (self.count - n + np.arange(n)) % self.size
        return self.data[:, idx].astype(np.float64)


class SyntheticSource:
    """Real-time synthetic EEG. `inject` adds a waveform starting at a clock time."""

    kind = "mock"

    def __init__(self, sfreq: float = 500.0, seed: int | None = None):
        self.sfreq = sfreq
        self.channels = CHANNELS
        self.background = BackgroundEEG(sfreq, seed=seed)
        self.t0 = clock()
        self.emitted = 0
        self.injections: list[tuple[int, np.ndarray]] = []

    def inject(self, waveform: np.ndarray, at: float | None = None) -> None:
        start = int(((at if at is not None else clock()) - self.t0) * self.sfreq)
        self.injections.append((max(start, self.emitted), waveform))

    def pull(self) -> tuple[np.ndarray, np.ndarray]:
        target = int((clock() - self.t0) * self.sfreq)
        n = target - self.emitted
        data = self.background.generate(n)
        lo, hi = self.emitted, self.emitted + n
        keep = []
        for start, wave in self.injections:
            end = start + wave.shape[1]
            a, b = max(start, lo), min(end, hi)
            if a < b:
                data[:, a - lo:b - lo] += wave[:, a - start:b - start]
            if end > hi:
                keep.append((start, wave))
        self.injections = keep
        times = self.t0 + (lo + np.arange(n)) / self.sfreq
        self.emitted = hi
        return data, times


class ReplaySource:
    """Loops an ANT Neuro .cnt recording in real time (for signal display and offline checks)."""

    kind = "replay"

    def __init__(self, path: Path):
        from ml.ant_neuro.signals import read_ant_recording

        raw = read_ant_recording(Path(path))
        self.sfreq = float(raw.info["sfreq"])
        self.channels = tuple(raw.ch_names)
        data = raw.get_data()
        self.data = data - np.median(data, axis=1, keepdims=True)   # remove DC offsets
        self.t0 = clock()
        self.emitted = 0

    def inject(self, waveform, at=None) -> None:  # replay data is real; nothing is injected
        return None

    def pull(self):
        target = int((clock() - self.t0) * self.sfreq)
        idx = np.arange(self.emitted, target)
        out = self.data[:, idx % self.data.shape[1]]
        times = self.t0 + idx / self.sfreq
        self.emitted = target
        return out, times


class LslSource:
    """Live eego stream over Lab Streaming Layer. Channels are selected by label."""

    kind = "lsl"

    def __init__(self, stream_type: str = "EEG", name: str | None = None, timeout: float = 5.0):
        import pylsl

        prop, value = ("name", name) if name else ("type", stream_type)
        found = pylsl.resolve_byprop(prop, value, timeout=timeout)
        if not found:
            raise RuntimeError(f"No LSL stream with {prop}={value!r} found on the network.")
        info = found[0]
        self.inlet = pylsl.StreamInlet(info, max_buflen=360,
                                       processing_flags=pylsl.proc_clocksync | pylsl.proc_dejitter)
        full = self.inlet.info()
        self.sfreq = float(full.nominal_srate())
        labels = []
        ch = full.desc().child("channels").child("channel")
        for _ in range(full.channel_count()):
            labels.append(ch.child_value("label"))
            ch = ch.next_sibling()
        lookup = {label.strip().lower(): i for i, label in enumerate(labels) if label}
        if all(name.lower() in lookup for name in CHANNELS):
            self.select = [lookup[name.lower()] for name in CHANNELS]
        elif full.channel_count() >= len(CHANNELS):
            self.select = list(range(len(CHANNELS)))  # assume eego order when labels are absent
        else:
            raise RuntimeError(f"Stream has {full.channel_count()} channels; expected the 24-channel eego montage.")
        self.channels = CHANNELS
        self.stream_name = info.name()
        self.labels = labels
        self.scale = 1.0

    def inject(self, waveform, at=None) -> None:  # never fake live data
        return None

    def pull(self):
        samples, times = self.inlet.pull_chunk(timeout=0.0, max_samples=4096)
        if not times:
            return np.zeros((len(CHANNELS), 0)), np.zeros(0)
        data = np.asarray(samples, dtype=np.float64)[:, self.select].T
        return data, np.asarray(times)


class Recorder:
    def __init__(self):
        self.active = False
        self.chunks: list[np.ndarray] = []
        self.times: list[np.ndarray] = []
        self.markers: list[dict] = []

    def start(self):
        self.active, self.chunks, self.times, self.markers = True, [], [], []

    def add(self, data, times):
        if self.active and len(times):
            self.chunks.append(data.astype(np.float32))
            self.times.append(times)

    def mark(self, marker: dict):
        if self.active:
            self.markers.append(marker)

    def stop(self, sfreq: float, channels) -> Path | None:
        self.active = False
        if not self.chunks:
            return None
        RECORDINGS.mkdir(exist_ok=True)
        path = RECORDINGS / f"session-{time.strftime('%Y%m%d-%H%M%S')}.npz"
        np.savez_compressed(path, data=np.hstack(self.chunks), times=np.concatenate(self.times),
                            sfreq=sfreq, channels=np.array(channels), markers=json.dumps(self.markers))
        return path
