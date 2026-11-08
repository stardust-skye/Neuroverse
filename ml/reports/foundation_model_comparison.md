# EEG foundation-model experiment status

## Summary

The existing Gradient Boosting pipeline is the only completed model in this
comparison. No EEGNet or pretrained-model checkpoint was loaded, and no new
training or inference metrics were produced. Therefore, there is no evidence
that a foundation model improves on the baseline. The production workload model
was not changed.

The target classes are **LOW**, **MEDIUM**, and **HIGH** task conditions from
the UAB N-back dataset: position 1-back, arithmetic 1-back, and dual arithmetic
2-back, respectively. These labels describe the documented task conditions;
they are not direct measurements of individual psychological workload or
stress. The dataset README does not define numeric phase IDs, while the existing
pipeline assumes phase 2 is the active task interval.

## Dataset and validation

- 6,063 10-second windows from 16 participants.
- Class counts: LOW 1,996; MEDIUM 2,017; HIGH 2,050.
- Emotiv EPOC X electrodes: AF3, F7, F3, FC5, T7, P7, O1, O2, P8, T8, FC6, F4,
  F8, AF4.
- Timestamp estimate: 126.9 Hz; the pipeline declares 128 Hz.
- Existing validation: 5-fold `StratifiedGroupKFold` grouped by participant,
  seed 42, with 4/3/3/3/3 test participants per fold. The reported metrics are
  pooled out-of-fold scores, not a separately pre-registered final test.
- Class counts are nearly balanced; the baseline report does not report class
  reweighting.

## Completed baseline

| Model | Accuracy | Balanced accuracy | Macro precision | Macro recall | Macro F1 |
|---|---:|---:|---:|---:|---:|
| Gradient Boosting | 0.4755 | 0.4763 | 0.4633 | 0.4763 | 0.4678 |

Per-class precision / recall / F1:

| Class | Precision | Recall | F1 |
|---|---:|---:|---:|
| LOW | 0.5884 | 0.6784 | 0.6302 |
| MEDIUM | 0.3479 | 0.2890 | 0.3157 |
| HIGH | 0.4535 | 0.4615 | 0.4574 |

Confusion matrix (rows are actual; columns are predicted; order LOW, MEDIUM,
HIGH):

```text
[[1354, 393, 249],
 [ 543, 583, 891],
 [ 404, 700, 946]]
```

Baseline training and per-window inference times were not recorded. The source
metrics are in [`model_evaluation.json`](./model_evaluation.json).

## Pretrained model compatibility and status

| Model | Input/compatibility assessment | Status |
|---|---|---|
| LaBraM | Published path uses 200 Hz microvolt-scale EEG, 0.1–75 Hz filtering, and a 50 Hz notch. A valid Emotiv channel-embedding map and raw-signal conversion have not been verified against the official implementation. | Not loaded; no metrics |
| EEGPT | Official large model is 58-channel, 256 Hz, 4-second input. Its official named-channel dictionary contains all 14 Emotiv channel names, allowing a potential exact named subset without fabricating electrodes. Resampling, units/preprocessing, checkpoint loading, and inference remain unvalidated. | Not loaded; no metrics |
| BIOT | The available 16-channel checkpoint expects a specific bipolar TCP montage. Fourteen Emotiv electrode channels are not equivalent to those bipolar derivations. | Incompatible with current inputs; not loaded |
| EEGNet | No EEGNet implementation or raw-signal experiment path exists in the current pipeline. | Not run |

The installed PyTorch is CPU-only (`2.7.0+cpu`). An NVIDIA RTX 3050 with 4 GB
VRAM is present but unavailable to PyTorch; system RAM was 15.7 GB total with
5.2 GB free when inspected. No checkpoint was downloaded. ANT Neuro recordings
remain separate and were not used for workload classification.

## Stages and conclusion

1. **Baseline:** completed from the existing participant-grouped CV report.
2. **Checkpoint smoke tests:** not run.
3. **Frozen encoder representations:** not run.
4. **Lightweight classification head:** not run.
5. **EEGNet/foundation comparison:** not run.
6. **Fine-tuning:** not run.

No pretrained-model improvement can be claimed. The next safe step is to
validate preprocessing and channel mapping against the official model code, then
load at most one checkpoint for a bounded smoke test before any feature
extraction or training.
