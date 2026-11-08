# ANT Neuro live-stream and model compatibility

## Status and scope

This is an inspection and architecture proposal, not a production LSL adapter
or a model evaluation. No models were trained, no model artifacts or CNT files
were modified, and no eego, network, or firewall settings were changed.

An earlier smoke test on 2026-11-07 received an actual batch of **1,024 by 25**
samples from an LSL stream named
`EE225-020034-000943_on_BOOK-R5F4LN9527`. The resolver reported type `EEG`,
nominal rate 500 Hz, format `double64`, hostname `BOOK-R5F4LN9527`, and an
empty source ID. This is evidence of reception at that time, not evidence that
the current model can use the stream.

During this audit, a fresh 30-second search found **no LSL streams**. Full
inlet XML metadata and another sample batch could not be obtained. Consequently
the live channel names, types, units, ordering, and the role of channel 25 are
**unknown**. An auxiliary, trigger, reference, status, or EEG channel is
possible, but none can be confirmed or assigned an index from the available
evidence. The previous smoke test did not fetch the full inlet description.
Do not treat the stream-level type `EEG` as a classification of every channel.

## Diagnostic and live metadata capture

[`test_lsl_connection.py`](../test_lsl_connection.py) now retrieves the full
`StreamInlet.info()` XML description, reports the channel entries in their
supplied order and displays label, type, unit, other channel fields, and
non-channel description metadata. Missing entries or values are explicitly
reported rather than inferred; a count mismatch is flagged. It then attempts
to receive a sample batch within the shared 10-second open/metadata/sample
budget. It does not record samples to disk or perform inference.

When the source is broadcasting and reachable, run from the project root:

```powershell
.\venv\Scripts\python.exe ml\ant_neuro\test_lsl_connection.py --stream-name "EE225-020034-000943_on_BOOK-R5F4LN9527"
```

The stream name selector is exact. If the name has changed, omit the selector
to list all visible streams; without it the diagnostic tests the first EEG
stream found. Review the selected name and host before interpreting results.
The source must publish channel metadata for the script to report it; missing
or ambiguous metadata must be clarified with the eego team, not reconstructed
from the CNT order. Successful sample reception alone does not establish
channel meaning or physical calibration.

## CNT versus live stream

All three root recordings were reopened with `antio.io.read_raw_ant` using
`preload=False`. The reader exposes 24 EEG-typed channels in the same exact
order in each file, at 500 Hz. Detailed signal quality, units, markers and
reference limitations are documented in
[`recording-inspection.md`](./recording-inspection.md).

| CNT file | Samples | Duration | CNT channels | Live channel-by-channel comparison |
|---|---:|---:|---:|---|
| `8_team8_2026-11-07_15-25-37.cnt` | 11,702 | 23.404 s | 24 | Not possible: live channel metadata unavailable in this audit |
| `8_team8_2026-11-07_15-36-38.cnt` | 17,778 | 35.556 s | 24 | Not possible: live channel metadata unavailable in this audit |
| `8_team8_2026-11-07_15-38-02.cnt` | 15,650 | 31.300 s | 24 | Not possible: live channel metadata unavailable in this audit |

| Position | CNT name | Position | CNT name | Position | CNT name |
|---:|---|---:|---|---:|---|
| 1 | Fp1 | 9 | F10 | 17 | P7 |
| 2 | Fp2 | 10 | T9 | 18 | P3 |
| 3 | F9 | 11 | T7 | 19 | Pz |
| 4 | F7 | 12 | C3 | 20 | P4 |
| 5 | F3 | 13 | C4 | 21 | P8 |
| 6 | Fz | 14 | T8 | 22 | P10 |
| 7 | F4 | 15 | T10 | 23 | O1 |
| 8 | F8 | 16 | P9 | 24 | O2 |

The CNT header's `REF:REF` notation and calibration do not identify the
physical reference location. All CNT channels are reader-typed EEG, but actual
placement and what the live producer publishes must be confirmed. At present
the only verified rate/count comparison is CNT 24 at 500 Hz versus the
**previously observed** LSL 25 at 500 Hz; one extra channel does not establish
which channel, where it is in the order, or what it means.

## Existing inference contract

The backend's [`api.py`](../../api.py) loads
[`workload_classifier.joblib`](../../models/workload_classifier.joblib) via
[`inference.py`](../../inference.py), or replays preprocessed recorded UAB
windows. Direct inspection of the saved artifact in the project venv found a
`GradientBoostingClassifier`, 140 input features, class codes 1/2/3 and a
10-second training window. It predicts UAB N-back **task conditions**:
`low`, `moderate`, and `high`. The returned `model_score` and probability map
are model outputs, not validated measurements of stress or actual workload.
The frontend EEG service currently says its live adapter is coming soon.

The training feature order is 14 Emotiv positions:
`AF3, F7, F3, FC5, T7, P7, O1, O2, P8, T8, FC6, F4, F8, AF4`,
with bands `Theta, Alpha, BetaL, BetaH, Gamma` per electrode. The vector
contains 70 `LOG_POW.<electrode>.<band>` features in that order followed by
70 `REL_<electrode>.<band>` features in the same order. The API accepts named
finite features and assembles a float64 `(1, 140)` vector; it does not accept a
raw EEG tensor. There is no StandardScaler in the saved gradient boosting
artifact.

[`preprocess.py`](../../preprocess.py) consumes already computed Emotiv band
powers, selecting phase 2 and grouping into non-overlapping 10-second bins.
It requires at least 40 valid observations per band at the dataset's 8 Hz
power update rate, averages each band, clips negative means, applies `log1p`,
and computes within-electrode relative band powers (zero for zero denominator).
It does not filter or resample CNT/raw LSL data, or calculate the original
Emotiv powers. The source dataset's documented raw rate is 128 Hz, but the
model endpoint has no raw sampling-rate input. Original power definitions,
units, upstream filtering, and reference equivalence remain unresolved.

The existing ANT Neuro work reads/filter-signals for review and annotation; it
is not a validated blink, wink, or jaw-clench classifier. The three
session-level activity descriptions are not timestamped event labels. The
workload model is a separate task and must not be used as gesture recognition.

| Property | Live LSL | CNT | Workload classifier | Conclusion |
|---|---|---|---|---|
| Representation | Earlier batch: 25 numeric values/sample; current metadata unavailable | 24 raw EEG channels | 140 named derived features | Raw stream cannot be submitted directly |
| Channels/order | Unknown | 24 names above | 14 Emotiv positions above | Live mapping unverified; CNT shares only 10 names, missing AF3, AF4, FC5, FC6 |
| Rate | Earlier nominal 500 Hz | 500 Hz | Source raw 128 Hz, precomputed power updates 8 Hz | A matching nominal rate does not establish feature equivalence |
| Window | Continuous source, previously sampled briefly | Continuous short recordings | Non-overlapping 10-second feature bins | Overlapping live windows would require separate validation |
| Units/reference | Unknown | Reader volts; header `REF:REF` | Power units and source reference not established | Do not assume compatibility |
| Task | Stream type EEG, not a task label | Intended gesture sessions | N-back condition classification | No validated live gesture or ANT workload inference |

No electrode selection, resampling, zero-filling, duplication, or channel
renaming can be assumed to turn this stream into valid workload-model input.
Even the CNT's 10 shared names do not prove physical montage/reference or
feature equivalence. Gesture and workload compatibility must be established
separately using suitable ground truth.

## Proposed continuous runtime architecture — not implemented

1. **Acquisition supervisor:** one backend-owned persistent inlet per selected
   source, shared by all clients. Use a configured unique identity, not merely
   the first EEG stream; the observed empty source ID is insufficient for safe
   automatic re-identification. Validate full metadata, exact channel order,
   rate, units and role against an explicit approved contract before enabling
   any processing. Reject ambiguous sources and metadata changes.
2. **Receiver and bounded buffer:** a dedicated backend worker performs
   time-bounded chunk pulls, retaining sample timestamps and channel values in
   a bounded rolling ring buffer. Preserve channel order and raw units; do not
   treat unknown channels as electrodes. Check finite values, sample shapes,
   timestamp monotonicity, gaps, observed rate, saturation/flatline and source
   freshness. Thresholds must be established for the validated device and
   task, not invented from this brief smoke test. Never fill gaps silently.
3. **Window scheduler and inference gate:** configurable window duration,
   overlap and inference interval, bounded by the chosen model's validated
   input contract. Only complete, contiguous, quality-approved windows enter a
   task-specific backend preprocessing/model pipeline. No current ANT
   workload or gesture model is approved. A proposed overlapping live window
   schedule does not change the saved workload model's 10-second training
   contract and must be validated independently.
4. **Connection lifecycle:** states such as `DISCOVERING`, `CONNECTING`,
   `CONNECTED_NO_SAMPLES`, `BUFFERING`, `READY`, `DEGRADED`, and
   `DISCONNECTED`. On timeout, loss, gaps, restart, or unexpected metadata
   change, mark predictions stale, clear affected buffered windows, and
   reconnect with bounded backoff. Re-check identity and full metadata before
   resuming; never merge samples across a discontinuity into one window.
   Track LSL timestamps and clock-domain conversion explicitly; do not compare
   uncorrected remote timestamps to local wall clock.
5. **Status and frontend delivery:** send versioned WebSocket messages with
   source `LIVE`, connection state, data freshness, last-sample age, quality
   flags, model/task identity and validated prediction if available. Include
   timestamps and explicit unavailable/reason fields; never send raw EEG by
   default. Use a bounded latest-state queue per client, handle slow
   consumers, and clean up subscribers without creating additional inlets.
   Keep replay and DEMO messages visibly distinct from LIVE.
6. **Fail-safe behavior:** missing/uncertain metadata, disconnected or stale
   data, invalid/gapped windows, model errors, and unvalidated outputs yield
   `UNKNOWN`/unavailable and hold adaptive difficulty; they must never become
   an invented low workload value. Invalidate retained prior predictions and
   adaptation streaks on loss. A model score alone is not validated
   confidence. Re-enable predictions only after identity, quality, complete
   window and model-specific validation checks pass.

## Recommended implementation plan

1. Restore the eego LSL source and run the diagnostic above. Capture the full
   ordered 25-channel labels/types/units and short batch dimensions, obtain
   the meaning of any extra channel and confirm reference and physical units
   with the vendor/team. Compare each live index with the CNT table; resolve
   missing/ambiguous XML before choosing channels.
2. Review electrode quality and collect independently verified gesture and
   rest intervals, including wink side. Separately decide whether an ANT
   workload model is needed and gather appropriate workload ground truth.
   Neither goal is satisfied by the current Emotiv workload artifact.
3. Define and validate a task-specific acquisition, preprocessing and model
   contract offline, including montage, reference, units, sampling, window,
   labels, quality gates and participant-independent evaluation.
4. Only then implement the persistent backend receiver, buffer and status-only
   WebSocket first; test reconnection, gaps, identity changes, slow clients and
   unknown-state behavior with explicitly labeled test streams and real
   hardware. Enable inference behind a gate only after task/model
   compatibility and reliability are demonstrated.
