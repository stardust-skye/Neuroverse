# ANT Neuro recording and model compatibility inspection

## Scope and method

The three root-level files opened successfully as ANT Neuro CNT/eeph version
4.3 with ANTIO 0.7.1 and MNE 1.13.2 in the project virtual environment.
`antio.io.read_raw_ant(..., preload=False)` was used; descriptive statistics
below cover every sample, read in chunks of at most 2,500 samples. The CNT
files and model artifact were not modified. No model was trained, no gesture
events were inferred, and no LSL stream was started.

The supplied session descriptions associate 15:25 with normal blinks, 15:36
with left/right winks, and 15:38 with jaw clenching. These are reported session
intentions, not verified labels for any sample or interval.

## Recording metadata and events

| Filename | Size (bytes) | Opened | Channels | Rate | Samples | Duration (samples / rate) | Annotations |
|---|---:|---|---:|---:|---:|---:|---|
| `8_team8_2026-11-07_15-25-37.cnt` | 417,082 | Yes | 24 | 500 Hz | 11,702 | 23.404 s | One zero-duration `1001` at 5.230 s |
| `8_team8_2026-11-07_15-36-38.cnt` | 634,044 | Yes | 24 | 500 Hz | 17,778 | 35.556 s | None |
| `8_team8_2026-11-07_15-38-02.cnt` | 604,560 | Yes | 24 | 500 Hz | 15,650 | 31.300 s | None |

`1001` is the reader's description; its meaning is undocumented and it is not
a verified blink event. No separate stimulus/trigger channels are identified
by the reader. These are the annotations exposed by ANTIO/MNE; unrecognized
vendor metadata cannot be ruled out.

All three headers list `1 0.0078125 uV REF:REF` for each channel. This is the
recorded calibration/reference notation; the physical reference electrode and
its placement cannot be established from `REF:REF` alone. MNE reports all
channel units as volts (`FIFF_UNIT_V`); `get_data()` returns volts, converted
to microvolts below by multiplying by 1,000,000. MNE reports per-channel
`cal=1` and `range=1` after reader conversion, and no custom re-reference
applied. These are not evidence of the original physical reference. All
reported channel locations are NaN, so actual electrode positions were not
recovered.

## Channel order and types

The order is identical in each file. ANTIO/MNE classifies every channel as EEG;
none is designated EOG, EMG, auxiliary, or stimulus. That classification does
not prove how every electrode was physically attached.

| Index (1-based) | Channel | Reader type | Index (1-based) | Channel | Reader type |
|---:|---|---|---:|---|---|
| 1 | Fp1 | EEG | 13 | C4 | EEG |
| 2 | Fp2 | EEG | 14 | T8 | EEG |
| 3 | F9 | EEG | 15 | T10 | EEG |
| 4 | F7 | EEG | 16 | P9 | EEG |
| 5 | F3 | EEG | 17 | P7 | EEG |
| 6 | Fz | EEG | 18 | P3 | EEG |
| 7 | F4 | EEG | 19 | Pz | EEG |
| 8 | F8 | EEG | 20 | P4 | EEG |
| 9 | F10 | EEG | 21 | P8 | EEG |
| 10 | T9 | EEG | 22 | P10 | EEG |
| 11 | T7 | EEG | 23 | O1 | EEG |
| 12 | C3 | EEG | 24 | O2 | EEG |

## Raw signal statistics and quality

The following are **unfiltered**, full-recording min, max, mean, and population
standard deviation, in microvolts. Means and ranges include large DC offsets;
they are not peak-to-peak EEG amplitudes after detrending. All samples were
finite, no channel was exactly flat across its recording, and the reader
reported no pre-marked bad channels. This does not rule out intermittent
dropouts, clipping, poor contact, or noise.

| Channel | 15:25 min | max | mean | SD | 15:36 min | max | mean | SD | 15:38 min | max | mean | SD |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Fp1 | 17016.688 | 23660.297 | 19221.331 | 2166.450 | 23668.984 | 25255.438 | 24205.384 | 282.801 | 24325.305 | 25411.758 | 24883.557 | 160.842 |
| Fp2 | 7795.367 | 13367.922 | 9296.250 | 1644.483 | 12214.312 | 13750.125 | 12654.002 | 346.188 | 12664.703 | 13430.352 | 12951.999 | 84.094 |
| F9 | 21159.945 | 24307.344 | 22385.261 | 861.199 | 23568.258 | 27013.523 | 24252.011 | 922.663 | 22673.469 | 24191.281 | 23633.581 | 126.253 |
| F7 | 16935.383 | 18483.891 | 17587.584 | 423.548 | 20033.391 | 21405.203 | 20413.108 | 358.736 | 20020.023 | 21098.664 | 20697.917 | 118.280 |
| F3 | 16701.180 | 17209.469 | 16944.955 | 85.920 | 15474.195 | 15669.805 | 15575.382 | 28.989 | 15425.297 | 16054.852 | 15668.045 | 85.600 |
| Fz | 10866.828 | 11267.516 | 11036.871 | 82.494 | 13792.617 | 14034.508 | 13941.591 | 45.453 | 14011.352 | 14535.727 | 14247.797 | 87.113 |
| F4 | 11947.203 | 12467.039 | 12147.966 | 102.375 | 12726.500 | 13038.359 | 12854.681 | 47.059 | 12691.250 | 13465.742 | 12955.048 | 98.020 |
| F8 | 19770.773 | 20875.367 | 20201.195 | 194.960 | 21924.070 | 22818.594 | 22275.960 | 113.025 | 21580.945 | 23094.477 | 22647.566 | 153.970 |
| F10 | 14673.312 | 17410.227 | 15658.669 | 884.978 | 16508.906 | 19798.734 | 17549.325 | 850.496 | 16265.680 | 17887.922 | 17422.383 | 124.404 |
| T9 | 10274.789 | 10758.180 | 10492.798 | 108.075 | 14618.977 | 15578.578 | 14892.087 | 201.117 | 14205.703 | 15446.852 | 15019.406 | 81.798 |
| T7 | 16214.359 | 16575.008 | 16421.801 | 83.899 | 20709.836 | 21128.336 | 20924.382 | 102.988 | 20872.039 | 23491.344 | 22126.307 | 526.856 |
| C3 | 13698.797 | 14091.195 | 13901.372 | 99.425 | 20533.938 | 21404.148 | 20956.149 | 227.290 | 21720.766 | 22784.930 | 22227.757 | 202.967 |
| C4 | 28093.648 | 29050.602 | 28566.333 | 192.293 | 33214.906 | 33699.883 | 33403.612 | 86.062 | 32769.953 | 33771.531 | 33471.073 | 114.025 |
| T8 | 23562.969 | 24327.141 | 24128.061 | 101.112 | 27200.648 | 27678.969 | 27420.030 | 68.025 | 26635.453 | 28154.531 | 27746.251 | 180.047 |
| T10 | 16433.859 | 17409.984 | 17127.359 | 278.567 | 10471.922 | 11844.180 | 11022.625 | 328.823 | 9503.453 | 10679.000 | 10401.196 | 94.201 |
| P9 | 25336.000 | 25926.672 | 25736.322 | 111.806 | 33973.094 | 35142.008 | 34891.683 | 106.023 | 34370.812 | 35831.766 | 35562.995 | 193.844 |
| P7 | 7920.117 | 8369.289 | 8267.993 | 86.914 | 10835.992 | 11095.812 | 10971.665 | 41.919 | 11367.758 | 11902.516 | 11598.088 | 105.003 |
| P3 | -200.609 | 215.945 | 88.841 | 88.967 | 2362.492 | 2720.492 | 2509.500 | 71.001 | 2921.312 | 3414.664 | 3190.826 | 120.004 |
| Pz | 3355.898 | 3957.391 | 3568.170 | 131.243 | 5837.125 | 6187.391 | 5989.991 | 79.323 | 6227.406 | 6613.734 | 6460.048 | 80.670 |
| P4 | 13318.695 | 13743.648 | 13538.914 | 70.862 | 13140.641 | 13409.297 | 13289.364 | 55.363 | 13482.078 | 13957.984 | 13768.639 | 71.283 |
| P8 | 8936.258 | 9568.055 | 9226.534 | 171.713 | 12165.336 | 12497.344 | 12334.309 | 67.057 | 12465.141 | 12981.531 | 12715.614 | 124.373 |
| P10 | 19060.781 | 19485.969 | 19332.787 | 90.424 | 24802.352 | 25619.133 | 25262.006 | 155.076 | 25758.852 | 26864.641 | 26467.440 | 245.275 |
| O1 | 18083.875 | 20242.750 | 19765.863 | 246.942 | 32040.508 | 34599.391 | 34012.712 | 330.556 | 33427.656 | 36110.734 | 35706.147 | 282.766 |
| O2 | 22665.258 | 23263.633 | 23065.899 | 113.980 | 27009.477 | 27632.617 | 27436.763 | 67.340 | 27261.320 | 28134.484 | 27922.102 | 153.460 |

For a reproducible relative-variability screen, the SD threshold is more than
three times the median channel SD within the same recording. It flags:

- 15:25 (median 112.893 uV): Fp1, Fp2, F9, F7, F10.
- 15:36 (median 104.506 uV): Fp2, F9, F7, F10, T10, O1.
- 15:38 (median 122.188 uV): T7.

These are **review flags**, not diagnoses of noisy channels: real eye/muscle
activity, drift, and contact artifacts can all increase raw SD. As an additional
rapid-change proxy, RMS adjacent-sample differences in 15:38 were 54.340 uV
for F8, 49.560 for F10, 46.253 for F9, and 44.403 for F7, versus 4.189 for
O1. This is not a frequency-specific noise test. Review raw and filtered traces,
spectra, clipping, and electrode contact/reference before deciding which signals
are suitable. No missing named channels were detected in these recordings; a
missing sensor not listed in the header cannot be identified this way.

## Current workload model input pipeline

- The API lazily loads [`workload_classifier.joblib`](../../models/workload_classifier.joblib)
  through [`inference.py`](../../inference.py); the artifact was actually loaded
  for this audit with scikit-learn 1.8.0, matching the recorded training version.
  It contains a `GradientBoostingClassifier`, 140 features, classes 1/2/3,
  a 10-second window and no `StandardScaler` pipeline. This describes the
  configured artifact, not proof that a backend is currently running.
- Task: classify UAB N-back task conditions as `low`, `moderate`, and `high`,
  respectively. These are experimental task-condition labels, not direct
  measurements of psychological stress or a gesture-recognition output.
- Training source: Emotiv EPOC X 14-electrode data with **precomputed**
  per-electrode power in Theta, Alpha, BetaL, BetaH, Gamma. The classifier
  consumes feature vectors, not a channels-by-time tensor. The ordered
  electrodes are `AF3, F7, F3, FC5, T7, P7, O1, O2, P8, T8, FC6, F4, F8, AF4`.
  Within each electrode, band order is `Theta, Alpha, BetaL, BetaH, Gamma`.
- The exact vector is the 70 `LOG_POW.<electrode>.<band>` features in the
  above electrode/band order followed by 70
  `REL_<electrode>.<band>` features in the same order. Inference constructs a
  finite float64 vector of length 140 from named inputs and passes shape
  `(1, 140)` to `predict_proba`; extra dictionary keys are ignored and missing
  required keys are rejected.
- [`preprocess.py`](../../preprocess.py) reads dataset power columns, selects
  phase 2 and supported N-back tests, floors timestamps into non-overlapping
  10-second bins, and requires at least 40 valid power observations per band
  (50% of 10 seconds at the declared 8 Hz power update rate). It computes
  each band's window mean, clips means below zero, applies `log1p` for LOG,
  and divides each band's clipped mean by the sum of the five clipped means
  for that electrode for REL; a zero denominator yields zero.
- This preprocessing code does **not** filter or resample raw EEG or compute
  the original band powers from raw samples. The dataset inspection records
  an original documented raw EEG rate of 128 Hz and an 8 Hz power update rate;
  neither is a raw input accepted by the current prediction endpoint.
  Exact power-band boundaries, calculation method, units and upstream
  filtering/reference are not established by this pipeline. Dataset reference
  and precise electrode placement assumptions must be verified separately.
- [`api.py`](../../api.py) accepts named features or replays preprocessed
  dataset windows. The frontend EEG service currently declares its adapter
  coming soon. This code does not establish a live ANT/LSL input path.

## Direct compatibility assessment

| Property | CNT recordings | Saved workload model / pipeline | Assessment |
|---|---|---|---|
| Task | Intended blink, wink and jaw-clench sessions | N-back condition classes | Different tasks; no gesture prediction |
| Input representation | 24 raw voltage time series | 140 derived named band-power features per window | Not directly compatible |
| Electrode names | 24 in the table above | 14 Emotiv positions listed above | 10 exact names overlap; AF3, AF4, FC5, FC6 are absent |
| Order | ANT order above | Specific Emotiv feature order above | Different; exact-name overlap is not complete mapping |
| Rate | 500 raw samples/s | Training-source raw 128 Hz; precomputed powers at 8 Hz | Different rates and representations; model has no raw-rate parameter |
| Windows | Continuous short recordings | Non-overlapping 10-second feature windows | A windowing stage would be needed, but is not sufficient |
| Units/features | MNE volts; CNT header uses uV calibration | Proprietary/source-computed band powers with undocumented units/method | Numerical equivalence not established |
| Reference/montage | `REF:REF`; physical reference and positions unknown | Emotiv acquisition/reference details not established in model | Cannot establish equivalence |

The existing ANT annotation code can read and filter these CNTs for human
review, but it does not produce the 140 model-compatible features. The
workload preprocessing expects existing Emotiv band powers, not raw CNTs.
Selecting only the 10 shared electrode names cannot satisfy the saved model:
four required positions would still be absent, and the different sensor,
reference, band-power computation, and task introduce distribution shifts.
Selecting channels may be a defensible design for a **separately evaluated**
gesture or workload model, but requires a documented hypothesis and
participant-independent validation; it is not a justified drop-in conversion.
Do not fabricate, duplicate, or silently substitute missing channels.

## Limitations and recommended next step

Confirm electrode placement, physical reference, calibration, signal quality,
and the meaning of marker `1001` with the recording team. Review the signals
and obtain verified event intervals and rest intervals, including wink side,
before designing a separate gesture-recognition pipeline; session names alone
are not labels. If workload inference is also desired, first determine the
original Emotiv band-power computation and whether a validated compatible
sensor montage and reference can be acquired, then evaluate on independently
labelled ANT workload recordings. These gesture sessions cannot validate a
workload model. Only after offline signal and task compatibility is established
should a separate LSL acquisition adapter be designed and verified against
real stream metadata and units.

Installing the missing reader/model dependencies allowed this inspection; the
initially installed scikit-learn 1.9.1 could not load the saved artifact
(`ModuleNotFoundError: No module named '_loss'`). Version 1.8.0, recorded in
the evaluation report, loaded it successfully. This confirms deserialization,
not the correctness or validity of predictions on new data.
