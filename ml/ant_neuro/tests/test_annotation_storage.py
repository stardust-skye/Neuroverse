import csv
import tempfile
import unittest
from pathlib import Path

from ml.ant_neuro.annotation_storage import load_review_state, save_annotations


class AnnotationStorageTests(unittest.TestCase):
    def test_confirmed_rows_are_saved_and_review_state_resumes(self):
        state = {
            "recordings": {
                "sample.cnt": [
                    {
                        "event_id": "candidate-001",
                        "status": "confirmed",
                        "label": "LEFT_WINK",
                        "review_start_seconds": 1.23456,
                        "review_end_seconds": 1.8,
                    },
                    {
                        "event_id": "candidate-002",
                        "status": "pending",
                        "label": "UNKNOWN",
                        "review_start_seconds": 2.0,
                        "review_end_seconds": 2.5,
                    },
                ]
            }
        }
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            review_path = root / "candidate_reviews.json"
            annotations_path = root / "gesture_annotations.csv"

            save_annotations(state, review_path, annotations_path)

            with annotations_path.open(newline="", encoding="utf-8") as handle:
                rows = list(csv.DictReader(handle))
            self.assertEqual(list(rows[0]), ["file", "start_seconds", "end_seconds", "label"])
            self.assertEqual(rows, [{
                "file": "sample.cnt",
                "start_seconds": "1.235",
                "end_seconds": "1.8",
                "label": "LEFT_WINK",
            }])
            self.assertEqual(load_review_state(review_path), state)

    def test_invalid_confirmed_interval_is_not_written(self):
        state = {
            "recordings": {
                "sample.cnt": [{
                    "event_id": "bad",
                    "status": "confirmed",
                    "label": "JAW_CLENCH",
                    "review_start_seconds": 2.0,
                    "review_end_seconds": 1.0,
                }]
            }
        }
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with self.assertRaises(ValueError):
                save_annotations(state, root / "reviews.json", root / "annotations.csv")
            self.assertFalse((root / "annotations.csv").exists())


if __name__ == "__main__":
    unittest.main()
