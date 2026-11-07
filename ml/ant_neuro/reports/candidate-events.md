# ANT Neuro signal candidate review

These are unlabelled signal excursions for human review, not confirmed gestures or training data. No model was trained. The original CNT files were read without modification.

## Method

- Reader: ANTIO/MNE.
- Display signal: zero-phase 4th-order Butterworth bandpass, 0.5-40 Hz; original raw samples remain unchanged.
- Candidate cues: frontal 0.5-8 Hz RMS energy, left/right frontal RMS asymmetry, and temporal 20-40 Hz RMS energy.
- A 100 ms RMS envelope, robust/98th-percentile threshold, duration filter, and 120 ms gap merge generate review intervals.
- Numeric event markers are displayed as metadata only. Marker 1001 is not interpreted as a gesture.

## Candidate intervals

| Recording | Start (s) | End (s) | Signal cues | Peak / threshold |
|---|---:|---:|---|---:|
| `8_team8_2026-11-07_15-25-37.cnt` | 12.096 | 12.304 | frontal_low_frequency | 1.36 |
| `8_team8_2026-11-07_15-25-37.cnt` | 12.448 | 12.712 | frontal_low_frequency, temporal_high_frequency | 1.51 |
| `8_team8_2026-11-07_15-25-37.cnt` | 14.204 | 14.676 | frontal_lateralized | 2.29 |
| `8_team8_2026-11-07_15-25-37.cnt` | 16.232 | 16.314 | temporal_high_frequency | 1.11 |
| `8_team8_2026-11-07_15-25-37.cnt` | 19.246 | 19.388 | temporal_high_frequency | 1.37 |
| `8_team8_2026-11-07_15-36-38.cnt` | 23.968 | 24.078 | frontal_lateralized, frontal_low_frequency | 1.16 |
| `8_team8_2026-11-07_15-36-38.cnt` | 24.298 | 24.530 | frontal_lateralized, frontal_low_frequency | 1.54 |
| `8_team8_2026-11-07_15-36-38.cnt` | 25.210 | 25.306 | frontal_lateralized | 1.08 |
| `8_team8_2026-11-07_15-36-38.cnt` | 25.632 | 25.696 | frontal_low_frequency | 1.05 |
| `8_team8_2026-11-07_15-36-38.cnt` | 26.952 | 27.046 | frontal_lateralized, frontal_low_frequency | 1.07 |
| `8_team8_2026-11-07_15-36-38.cnt` | 28.272 | 28.366 | frontal_lateralized, frontal_low_frequency | 1.08 |
| `8_team8_2026-11-07_15-36-38.cnt` | 29.720 | 29.794 | frontal_low_frequency | 1.05 |
| `8_team8_2026-11-07_15-38-02.cnt` | 0.542 | 0.622 | frontal_low_frequency | 1.19 |
| `8_team8_2026-11-07_15-38-02.cnt` | 2.284 | 2.388 | frontal_low_frequency | 1.36 |
| `8_team8_2026-11-07_15-38-02.cnt` | 7.356 | 7.424 | frontal_low_frequency | 1.14 |
| `8_team8_2026-11-07_15-38-02.cnt` | 9.226 | 9.338 | temporal_high_frequency | 1.53 |
| `8_team8_2026-11-07_15-38-02.cnt` | 9.502 | 9.572 | frontal_lateralized | 1.05 |
| `8_team8_2026-11-07_15-38-02.cnt` | 12.136 | 12.248 | temporal_high_frequency | 1.57 |
| `8_team8_2026-11-07_15-38-02.cnt` | 14.812 | 15.134 | frontal_lateralized, temporal_high_frequency | 1.21 |
| `8_team8_2026-11-07_15-38-02.cnt` | 17.394 | 17.526 | frontal_low_frequency | 1.70 |
| `8_team8_2026-11-07_15-38-02.cnt` | 18.504 | 18.706 | frontal_lateralized, temporal_high_frequency | 1.26 |
| `8_team8_2026-11-07_15-38-02.cnt` | 20.956 | 21.070 | frontal_lateralized | 1.43 |
| `8_team8_2026-11-07_15-38-02.cnt` | 22.342 | 22.440 | frontal_low_frequency | 1.33 |
| `8_team8_2026-11-07_15-38-02.cnt` | 23.106 | 23.340 | frontal_lateralized, temporal_high_frequency | 1.34 |
| `8_team8_2026-11-07_15-38-02.cnt` | 24.870 | 25.014 | frontal_low_frequency | 1.80 |
| `8_team8_2026-11-07_15-38-02.cnt` | 26.020 | 26.104 | temporal_high_frequency | 1.18 |
| `8_team8_2026-11-07_15-38-02.cnt` | 26.230 | 26.300 | frontal_lateralized | 1.02 |

The peak/threshold value is a detector score, not a probability or confidence that the interval contains a gesture. A candidate may be movement, noise, or another artifact.

## Recording and marker notes

- `8_team8_2026-11-07_15-25-37.cnt`: eeph 4.3, 500 Hz, 11702 samples, 23.404 s, 24 EEG channels; 1001 at 5.230 s (meaning undocumented).
- `8_team8_2026-11-07_15-36-38.cnt`: eeph 4.3, 500 Hz, 17778 samples, 35.556 s, 24 EEG channels; no annotations.
- `8_team8_2026-11-07_15-38-02.cnt`: eeph 4.3, 500 Hz, 15650 samples, 31.300 s, 24 EEG channels; no annotations.

## Wink-side assessment

Not established: lateralized frontal activity is a review cue, not ground truth for left versus right wink.
The recordings have no dedicated EOG or EMG channels. Human review must assign left/right wink labels from the session or other known context; the detector does not infer a side.

Review candidates in the local UI:

```powershell
python -m streamlit run ml/ant_neuro/annotation_app.py
```

Confirmed intervals are written to `ml/ant_neuro/annotations/gesture_annotations.csv`; candidate review decisions are resumable from the adjacent JSON state file.
