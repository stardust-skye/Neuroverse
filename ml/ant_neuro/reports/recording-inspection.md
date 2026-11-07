# ANT Neuro recording inspection

## Outcome

The three root-level recordings are ANT Neuro eego CNT files (eeph file version
4.3), read with `antio` 0.7.1 and MNE-Python 1.13.2. The decoded files contain
usable numeric signals, but do not provide sufficient gesture event timing for
supervised training. No gesture model or event labels were generated. The
original CNT files were not moved or modified.

The task descriptions associate the 15:25 recording with normal blinks, the
15:36 recording with left and right winks, and the 15:38 recording with jaw
clenching. Those associations identify the intended activity, not the
sample-level gesture intervals.

## Recording metadata and annotations

| File | Samples | Rate | Duration | Channels | Reader annotations |
|---|---:|---:|---:|---:|---|
| `8_team8_2026-11-07_15-25-37.cnt` | 11,702 | 500 Hz | 23.404 s | 24 | One zero-duration marker, code `1001`, at 5.230 s |
| `8_team8_2026-11-07_15-36-38.cnt` | 17,778 | 500 Hz | 35.556 s | 24 | None |
| `8_team8_2026-11-07_15-38-02.cnt` | 15,650 | 500 Hz | 31.300 s | 24 | None |

The reader reports measurement start times matching the timestamps in the
filenames. Marker `1001` has no accompanying description in the reader output;
its meaning is not documented in these files. It cannot safely be treated as a
blink label or as the start/end of a blink. The files expose no separate trigger
channel.

## Channels and signal observations

All three files have the same 24 channels, and the reader classifies every
channel as EEG:

`Fp1, Fp2, F9, F7, F3, Fz, F4, F8, F10, T9, T7, C3, C4, T8, T10, P9, P7, P3, Pz, P4, P8, P10, O1, O2`

There are no channels identified as EOG, EMG, auxiliary, or trigger. The
decoded arrays contain finite values. Their overall ranges, as returned by
MNE in volts, are approximately:

| File | Minimum | Maximum |
|---|---:|---:|
| 15:25 | -0.000201 V | 0.029051 V |
| 15:36 | 0.002362 V | 0.035142 V |
| 15:38 | 0.002921 V | 0.036111 V |

The large positive offsets and strongly differing channel variability (for
example, 15:25 Fp1 standard deviation is about 0.00217 V while several other
channels are near 0.0001 V) need unit/reference and signal-quality review,
including visual inspection and artifact assessment, before preprocessing
choices are finalized. Finite values alone do not establish that the recordings
are artifact-free or suitable for gesture classification.

## Labels required to proceed

Please provide an annotation file or intervals in seconds relative to the
start of each recording. We need:

- The meaning of marker `1001` in the 15:25 file, if known.
- Start and end (or event time plus intended analysis-window bounds) for each
  normal blink in the 15:25 file.
- Start and end for each left/right wink in the 15:36 file. Both sides can
  share a broader `WINK` model class later, but each event interval and side
  should first be reviewed separately.
- Start and end for each jaw clench in the 15:38 file.
- Neutral/rest intervals for each file, so the classifier can distinguish
  gestures from non-gesture EEG.

A CSV with columns `file,start_seconds,end_seconds,label` is suitable; use
`NORMAL_BLINK`, `LEFT_WINK`, `RIGHT_WINK`, `JAW_CLENCH`, `REST`, and
`UNKNOWN`. If only event timestamps are available, include the timestamp
reference (for example, CNT sample time) and the desired labeled window around
each event. Session-level descriptions are not sample-level labels. No training
should be performed until intervals have been reviewed and confirmed.

The source files remain at the repository root and are ignored by Git via
`*.cnt`; they are not copied into a second raw-data directory.
