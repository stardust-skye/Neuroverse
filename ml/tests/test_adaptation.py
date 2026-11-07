import unittest

from ml.adaptation import AdaptiveEngine


class AdaptiveEngineTests(unittest.TestCase):
    def test_requires_consistent_confident_predictions(self):
        engine = AdaptiveEngine(consistent_count=3, cooldown_seconds=0)
        self.assertEqual(engine.update("high", 0.9, 0).difficulty, "balanced")
        self.assertEqual(engine.update("high", 0.9, 10).difficulty, "balanced")
        changed = engine.update("high", 0.9, 20)
        self.assertEqual(changed.difficulty, "supportive")
        self.assertTrue(changed.hint_available)
        self.assertEqual(changed.time_pressure, "reduced")

    def test_low_confidence_resets_streak(self):
        engine = AdaptiveEngine(consistent_count=2, cooldown_seconds=0)
        engine.update("low", 0.9, 0)
        state = engine.update("low", 0.4, 1)
        self.assertEqual(state.consistent_predictions, 0)
        self.assertEqual(engine.update("low", 0.9, 2).difficulty, "balanced")

    def test_cooldown_and_gradual_levels(self):
        engine = AdaptiveEngine(consistent_count=1, cooldown_seconds=30)
        self.assertEqual(engine.update("low", 0.9, 0).difficulty, "challenging")
        self.assertEqual(engine.update("high", 0.9, 10).difficulty, "challenging")
        self.assertEqual(engine.update("high", 0.9, 31).difficulty, "balanced")


if __name__ == "__main__":
    unittest.main()
