"""Validate the Instinct ErrP features on a public dataset (BNCI Horizon 013-2015).

Chavarriaga & Millán (2010): 6 people watch a cursor that sometimes moves the wrong way.
We restrict to the channels our eego cap shares (Fz, F3, F4, C3, C4, Pz), resample to 500 Hz,
use exactly the same feature code as the live app, and report:
- within-person accuracy (5-fold CV, the realistic setting after a short calibration), and
- cross-person accuracy (leave-one-subject-out, no calibration for the new person).
Run: python -m ml.instinct.validate_public [--subjects 1 2 3 4 5 6]
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import mne
import numpy as np
from sklearn.discriminant_analysis import LinearDiscriminantAnalysis
from sklearn.metrics import balanced_accuracy_score
from sklearn.model_selection import StratifiedKFold, cross_val_score

from ml.instinct.channels import ERRP
from ml.instinct.reaction import POST_S, PRE_S, RestStats, errp_features

OUT = Path(__file__).resolve().parents[1] / "reports" / "errp_validation.json"
SFREQ = 500.0


def _lda():
    return LinearDiscriminantAnalysis(solver="lsqr", shrinkage="auto", priors=[0.5, 0.5])


def subject_features(dataset, subject: int) -> tuple[np.ndarray, np.ndarray]:
    sessions = dataset.get_data(subjects=[subject])[subject]
    X, y = [], []
    for runs in sessions.values():
        for raw in runs.values():
            raw = raw.copy().pick(list(ERRP)).load_data().resample(SFREQ, verbose="ERROR")
            events = mne.find_events(raw, verbose="ERROR") if "stim" in raw else None
            if events is None or not len(events):
                events, _ = mne.events_from_annotations(raw, verbose="ERROR")
                ids = {v: k for k, v in mne.events_from_annotations(raw, verbose="ERROR")[1].items()}
                labels = [1 if ids[e].lower().startswith("nontarget") else 0 for e in events[:, 2]]
            else:
                # MOABB encodes the wrong-direction (error) movements as "NonTarget".
                labels = [1 if code == dataset.event_id["NonTarget"] else 0 for code in events[:, 2]]
            data = raw.get_data()
            rest = RestStats.from_rest(data, SFREQ, ERRP)
            pre, post = int(PRE_S * SFREQ), int(POST_S * SFREQ)
            for (sample, _, _), label in zip(events, labels):
                if sample - pre >= 0 and sample + post <= data.shape[1]:
                    X.append(errp_features(data[:, sample - pre:sample + post], SFREQ, rest, ERRP))
                    y.append(label)
    return np.asarray(X), np.asarray(y)


def main() -> dict:
    parser = argparse.ArgumentParser()
    parser.add_argument("--subjects", type=int, nargs="+", default=[1, 2, 3, 4, 5, 6])
    args = parser.parse_args()
    from moabb.datasets import BNCI2015_013
    dataset = BNCI2015_013()
    per_subject = {}
    for subject in args.subjects:
        X, y = subject_features(dataset, subject)
        cv = cross_val_score(_lda(), X, y, cv=StratifiedKFold(5, shuffle=True, random_state=0),
                             scoring="balanced_accuracy")
        per_subject[subject] = {"X": X, "y": y, "within": float(cv.mean())}
        print(f"subject {subject}: {len(y)} trials, {int(y.sum())} errors, within-person {cv.mean():.3f}")
    cross = {}
    if len(per_subject) > 1:
        for held in per_subject:
            train = [s for s in per_subject if s != held]
            Xt = np.vstack([per_subject[s]["X"] for s in train])
            yt = np.concatenate([per_subject[s]["y"] for s in train])
            model = _lda().fit(Xt, yt)
            cross[held] = float(balanced_accuracy_score(per_subject[held]["y"], model.predict(per_subject[held]["X"])))
    report = {
        "dataset": "BNCI Horizon 013-2015 (Chavarriaga & Millán 2010), via MOABB BNCI2015_013",
        "channels": list(ERRP),
        "features": "Instinct live ErrP features (1-10 Hz, 4 post-onset windows), shrinkage LDA",
        "subjects": len(per_subject),
        "trials": int(sum(len(v["y"]) for v in per_subject.values())),
        "within_person_balanced_accuracy": round(float(np.mean([v["within"] for v in per_subject.values()])), 3),
        "within_person_by_subject": {str(s): round(v["within"], 3) for s, v in per_subject.items()},
        "cross_person_balanced_accuracy": round(float(np.mean(list(cross.values()))), 3) if cross else None,
        "cross_person_by_subject": {str(s): round(v, 3) for s, v in cross.items()},
        "chance": 0.5,
        "generated": time.strftime("%Y-%m-%d %H:%M"),
        "note": "Single-trial accuracy on a lab cursor task, not on reading text. Different headset and montage.",
    }
    OUT.write_text(json.dumps(report, indent=2))
    print(json.dumps({k: report[k] for k in ("within_person_balanced_accuracy", "cross_person_balanced_accuracy")}))
    return report


if __name__ == "__main__":
    main()
