import numpy as np
import pytest

from ml.instinct import llm, slm
from ml.instinct.gestures import WINDOW_S, GestureModel
from ml.instinct.memory import Memory
from ml.instinct.reaction import POST_S, PRE_S, default_model
from ml.instinct.stream import RingBuffer
from ml.instinct.synthetic import (BackgroundEEG, epoch_dataset, frown_waveform, nod_waveform,
                                   shake_waveform, UV)
from ml.instinct.channels import INDEX

FS = 500.0


@pytest.fixture(scope="module")
def model():
    return default_model(FS)


def test_reaction_separates_error_from_clean(model):
    epochs, labels = epoch_dataset(FS, n_error=40, n_correct=40, seed=123)
    flagged = np.array([model.score(e, FS)["flagged"] for e in epochs])
    assert flagged[labels == 1].mean() >= 0.85
    assert flagged[labels == 0].mean() <= 0.1


def test_frown_alone_flags(model):
    background = BackgroundEEG(FS, seed=4)
    hits = 0
    for _ in range(10):
        epoch = background.generate(int((PRE_S + POST_S) * FS))
        frown = frown_waveform(FS)
        epoch[:, int(PRE_S * FS):int(PRE_S * FS) + frown.shape[1]] += frown
        result = model.score(epoch, FS)
        hits += result["flagged"] and result["frown"] > result["errp"]
    assert hits >= 9


def test_nod_shake_and_rest():
    background = BackgroundEEG(FS, seed=9)
    gestures = GestureModel.from_rest(background.generate(int(30 * FS)), FS)
    n = int(WINDOW_S * FS)
    for wave, expected in ((nod_waveform, "nod"), (shake_waveform, "shake")):
        for _ in range(10):
            window = background.generate(n)
            motion = wave(FS)
            window[:, 50:50 + motion.shape[1]] += motion
            assert (gestures.detect(window, FS) or {}).get("gesture") == expected
    assert all(gestures.detect(background.generate(n), FS) is None for _ in range(30))


def test_single_blink_is_not_a_nod():
    background = BackgroundEEG(FS, seed=10)
    gestures = GestureModel.from_rest(background.generate(int(30 * FS)), FS)
    false = 0
    for _ in range(20):
        window = background.generate(int(WINDOW_S * FS))
        t = np.arange(int(0.3 * FS)) / FS
        blink = 150 * UV * np.sin(np.pi * t / t[-1])
        start = int(0.6 * FS)
        for name in ("Fp1", "Fp2"):
            window[INDEX[name], start:start + len(blink)] += blink
        false += gestures.detect(window, FS) is not None
    assert false <= 2


def test_ring_buffer_window_is_time_ordered():
    buffer = RingBuffer(2, 100.0, seconds=2.0)
    for k in range(5):
        times = (k * 100 + np.arange(100)) / 100.0
        buffer.push(np.vstack([times, times]), times)
    window = buffer.window(3.5, 4.0)
    assert window.shape == (2, 50) and np.all(np.diff(window[0]) > 0)
    assert buffer.window(0.0, 1.0) is None          # overwritten
    assert buffer.window(4.5, 5.5) is None          # not yet buffered


def test_slm_falls_back_to_rules(monkeypatch):
    monkeypatch.setattr(slm, "OLLAMA_URL", "http://127.0.0.1:9")
    result = slm.interpret("Dear Kevin,", "Dear Kevin, ...", "Email my landlord Sarah", {"score": 0.9})
    assert result["engine"] == "rules" and result["category"] == "recipient_name"
    assert slm.guess_category("I demand this is dealt with immediately.", "x") == "tone_aggressive"


def test_offline_draft_plants_and_learning_skips(monkeypatch):
    monkeypatch.setattr(llm, "_model", None)
    first = llm.draft("Email my landlord Sarah about the broken heater.", [], plant=True, learned=set())
    planted = {c["planted"] for c in first["chunks"]}
    assert {"recipient_name", "tone_aggressive"} <= planted
    assert first["chunks"][0]["text"].startswith("Dear ") and "Sarah" not in first["chunks"][0]["text"]
    later = llm.draft("Note to my manager Priya about leaving early.", [], plant=True,
                      learned={"recipient_name", "tone_aggressive"})
    assert all(c["planted"] is None for c in later["chunks"])
    fixed = llm.rewrite("Email my landlord Sarah", [c["text"] for c in first["chunks"]], 0, "", "recipient_name", [])
    assert fixed["text"] == "Dear Sarah,"


def test_memory_learns_and_exports(tmp_path):
    memory = Memory(tmp_path / "t.db")
    reading = {"score": 0.9, "errp": 0.8, "frown": 0.9, "flagged": True}
    rid = memory.add_reaction("user@gmail.com", "req", "Dear Kevin,", reading, simulated=False)
    memory.decide(rid, "accept", "recipient_name")
    assert memory.learned_categories() == {"recipient_name"}
    csv_text = memory.export_csv()
    header = csv_text.splitlines()[0].split(",")
    assert header[:3] == ["user_hash", "timestamp", "chunk"] and "human_decision" in header
    assert "Dear [NAME]," in csv_text and "user@gmail.com" not in csv_text
