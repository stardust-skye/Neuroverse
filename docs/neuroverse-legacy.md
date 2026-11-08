# Neuroverse

Neuroverse is a local-first interactive entertainment demo. Explore a branching story, care for a digital moon sprite, or paint in a full-screen studio with mouse, keyboard, and optional webcam-based gaze estimation.

## Run locally

1. Install Node.js 20 or later.
2. From the project directory, install dependencies:

   ```sh
   npm install
   ```

3. Start the development server:

   ```sh
   npm run dev
   ```

4. Open the local URL printed by Vite. Create a production build with `npm run build`.
5. Run deterministic gaze-math tests with `npm run test:gaze`; these do not validate real-person gaze accuracy.

## Inputs

Keyboard simulation is always available:

| Key | Movement | Default action |
| --- | --- | --- |
| Space | Blink | Confirm / interact |
| A | Wink | Switch / change |
| S | Simulated jaw-clench event | Special action (never webcam-inferred) |
| R | Rest | Return to neutral |

Keyboard shortcuts are ignored while typing in an input, textarea, or select. Controls work in each experience and can also be tested in the setup screen or developer panel (`Ctrl+Shift+D`). Movement-to-action mappings can be changed on the setup screen and are saved in local storage.

Webcam mode is optional. Select it in setup and explicitly enable the camera; grant browser permission when prompted. The face-landmark task and WASM runtime are fetched from their published hosting URLs, so webcam mode needs an internet connection the first time it loads. Camera frames are processed in the browser, are not recorded, and are not sent to an application backend. Eye closure is recognized as discrete events: bilateral blink, left wink, and right wink. The thresholds and timing are experimental; real-person validation is still required. Webcam jaw-clench inference is disabled because mouth opening is not a reliable clench signal. Keyboard and mouse controls remain available if camera access or model loading fails.

EEG mode is explicitly marked as coming soon. The project does not claim or simulate an EEG hardware connection.

## Experiences and persistence

- **The Last Signal:** A playable branching story with multiple endings.
- **Miso:** A pet with needs, levels, reactions, and a locally saved interaction history.
- **Create Mode:** A full-screen canvas with five distinct brushes, color palette, brush sizing, undo/redo, clear confirmation, high-resolution PNG export, and a locally saved gallery.
- Pet progress, artwork, and input mappings are stored in the browser's local storage.

In **Create Mode**, select **Enable Gaze** to request camera permission. The browser downloads the existing MediaPipe Face Landmarker assets, estimates eye direction locally, and asks for a nine-point calibration with repeated samples before showing a gaze cursor. The on-screen diagnostic panel reports face status, gaze features, normalized mapping, calibration residual, cursor coordinates, and gesture events. Calibration residuals are a fit check, not proof of real-world accuracy. The preview is mirrored for comfort; gaze features are estimated from the original, unmirrored camera coordinates and fitted directly to screen targets. The sensitivity slider changes the eye-closure threshold; a wink must remain closed for at least 350 ms to reduce accidental selections. Blink/wink distinction remains experimental and requires human verification. A recognized blink advances the highlighted control and a sustained wink selects it. Hold **Space** or the mouse button to draw; `G` toggles drawing, and `Escape` pauses. Losing the face pauses active drawing. Jaw-clench detection is disabled. Strokes retain ordered point/time/brush/color/size data with the artwork in the local gallery. **PLAY ART / STOP ART** draws its animation on a separate overlay canvas; stopping the animation leaves the original canvas unchanged.

For a first-time studio session: allow camera access and use even lighting. Select **CALIBRATE** and, in order, fixate **center → top-left → top → top-right → right → bottom-right → bottom → bottom-left → left**, capturing each target only after holding your gaze steady. After fitting, open **DIAGNOSTICS**, repeat that same nine-target order, and check that screen/canvas cursor coordinates are left of center for left targets, right for right targets, above center for top targets, below for bottom targets, and near center for the center target. Recalibrate if any direction is reversed or inconsistent. If camera access is blocked or unavailable, use the mouse or hold **Space** to draw; do not treat fallback pointer movement as gaze input.

### Gaze validation checklist

- Automated: `npm run test:frontend` fits a synthetic nine-point calibration and checks that every target maps back to its normalized screen position; separate tests verify left/right, up/down, center, outlier rejection, and smoothing.
- Human-required: enable gaze with a real person, hold the head comfortably still, and fixate each of the nine visible targets in turn. Record the displayed cursor position at each target; verify left/right and top/bottom ordering, center proximity, and that the preview, landmarks, gaze indicator, and painting cursor remain visually consistent. Repeat after recalibration. This real-person check has not yet been performed, so no real-world accuracy claim is made.

**Play Mode** is an optional painting challenge with a large, centered green target. Each round tracks 8×8 target coverage, sampled hit/miss accuracy, and elapsed time; manual completion requires 70% coverage. Difficulty changes only after a completed round: repeated successful rounds with the manually selected LOW demo condition can gradually shrink the target; manually selected HIGH demo can enlarge it; MODERATE or UNKNOWN holds difficulty. The application currently has no live EEG stream or validated live strain estimate, so the default status is **EEG unavailable** and difficulty holds. The explicitly labeled **DEMO SIMULATION** selector is a user-chosen test condition, not a sensor reading. **RESET CHALLENGE** restores the target and round counter. Keyboard (`Space`) and mouse drawing remain available. A real person must still validate gaze direction and control comfort.

## Sensor architecture and current capability

Facial gesture timing is implemented in `src/gestures.ts`; gaze math and calibration are in `src/gaze.ts`; challenge adaptation is separate in `src/challenge.ts`; and stroke history is in `src/strokes.ts`. The ANT Neuro CNT files are only locally inspected and annotated; the current recordings do not contain reviewed sample-level gesture labels. No EEG gesture classifier or live EEG adapter exists. The local FastAPI service supports recorded UAB workload replay only; it is not a live headset stream. `pylsl` and `mne_lsl` are not installed, and no LSL stream source was found in the repository. The frontend and backend explicitly distinguish the recorded replay from live input.

### Hardware validation before a live demo

Automated tests cover synthetic coordinate mapping and interaction rules, not a physical webcam or EEG headset. Before presenting, test camera permission/startup, face and landmark status, cursor alignment against all nine calibration targets, cursor and paint alignment, and blink/wink behavior at the chosen sensitivity in the intended room lighting. Confirm mouse and Space fallback if the camera is denied. Live ANT Neuro streaming is unavailable: the project has no vendor/LSL acquisition process, stream reader, device metadata/quality path, or live prediction transport. `/api/workload/replay` is the production model's recorded-data inference path; live hardware values are not currently sent to the frontend.

### Workload data and interpretation

- **Current primary local dataset:** UAB N-back, already in `workload_dataset/`. It has 16 participants, 14 Emotiv EPOC X channels, and task-condition classes (position 1-back, arithmetic 1-back, dual arithmetic 2-back). These labels are not subjective instantaneous workload or stress ratings. Existing grouped evaluation is 5-fold by participant; the Gradient Boosting baseline is 47.6% accuracy and 46.8% macro F1 across 6,063 windows. See [the baseline metrics](./ml/reports/model_evaluation.json) and [foundation-model experiment status](./ml/reports/foundation_model_comparison.md).
- **STEW candidate:** 48 participants, 14 Emotiv EPOC channels at 128 Hz, 2.5-minute rest/task recordings, and separate 1–9 perceived-workload ratings. The official IEEE DataPort listing requires account access to download. It is the closer future option for ratings and headset montage, but has not been downloaded, checked for licensing terms, or validated against the current headset firmware.
- **PhysioNet 2026 stress-resilience candidate:** 35 analyzed participants using a g.tec 32-channel hybrid EEG-fNIRS setup at 250 Hz, with six task phases (resting baseline, working baseline, stress 1, recovery 1, stress 2, recovery 2) and synchronized multimodal recordings. These are experimental phases, not direct moment-to-moment stress ratings. Its montage and acquisition differ from the ANT Neuro setup; downloads were not attempted because the per-participant grouped data are large (the listing says each grouped folder is under 10 GB). No stress model is trained from these labels.

The current UAB task-condition model may be used only as a **cognitive-workload task-condition proxy** in recorded replay. It is not relabeled as stress or used to change the live challenge. The source recordings remain unchanged. The headset's supported live streaming/API route has not been verified on this machine; a future integration needs vendor/LSL access and device-specific validation.

## Known limitations

- Gaze calibration is a nine-point approximate mapping with a residual check; synthetic coordinate tests do not validate real-person accuracy or replace the documented nine-position human test.
- Blink and wink thresholds are fixed experimental defaults and are not personalized; actual camera direction and selection reliability need human validation.
- EEG workload estimation is recorded-replay only. Live ANT Neuro strain, signal quality, and resting-baseline calibration are not implemented.
- EEG jaw-clench detection is disabled; the ANT Neuro gesture recordings need reviewed event intervals before a gesture model can be evaluated.
- The high/low challenge conditions are available only in the clearly labeled user-set demo simulator until a valid live strain model and signal-quality path are connected.
- Webcam model/runtime assets are hosted externally and are fetched only after the user enables webcam mode.
- There is no account or cloud sync. Saved artwork and its vector-like stroke history are stored in browser local storage.

## NEURO-ADAPT workload demo

The optional Python pipeline lives in `ml/` and reads the original dataset in `workload_dataset/` without changing it. It trains on N-back **task-condition labels** only: test 1 is the documented low-workload position 1-back condition, test 2 is moderate arithmetic 1-back, and test 3 is high dual arithmetic 2-back. These are experimental task labels, not direct measurements or diagnoses of a participant’s internal mental state. The included dataset README does not define the numeric `phase` values; the pipeline uses phase 2 as the likely task interval based on its timing. Confirm that mapping against the original protocol before interpreting results.

### ANT Neuro gesture annotation

The ANT Neuro EEG recordings are read directly from repository-root `.cnt`
files with ANTIO/MNE and are not copied or modified. Their activity descriptions
are session-level only; do not treat every sample in a session as a gesture.
Inspect recordings and generate signal-based review candidates with:

```sh
python -m ml.ant_neuro.inspect_cnt
python -m streamlit run ml/ant_neuro/annotation_app.py
```

The local review UI filters a copy of the signals for visualization, shows
frontal/temporal/all-channel traces and event-marker positions, and lets a
reviewer zoom, adjust candidate times, assign or reject labels, or add intervals
manually. Candidate signals are not ground truth. Only reviewer-confirmed rows
are exported to `ml/ant_neuro/annotations/gesture_annotations.csv`; review
decisions are saved separately so work can resume. Blink, wink, jaw-clench, and
rest intervals must be reviewed before any gesture model is trained. The
current recordings have no dedicated EOG/EMG channels, and left-versus-right
wink distinguishability has not been established.

The current dataset contains 16 documented N-back participants and 48 participant/task recordings, with Emotiv EPOC X 14-channel signals. A sample timestamp analysis estimates about 126.9 Hz for raw rows; the dataset authors' processing code declares a 128 Hz raw rate and 8 Hz power-feature rate. The recordings include vendor-provided Theta, Alpha, BetaL, BetaH, and Gamma band-power columns, with undocumented units. Ten-second windows use the provided band powers; no raw-signal filtering is applied. Scale-sensitive models standardize features inside each training fold only.

Install the Python dependencies if needed:

```sh
python -m pip install -r ml/requirements.txt
python -m ml.inspect_dataset
python -m ml.preprocess
python -m ml.train
```

Training compares logistic regression, random forest, support vector machine, and gradient boosting with five-fold `StratifiedGroupKFold` validation, keeping each participant entirely within one fold. The model with the highest grouped-CV macro F1 is refit on all dataset windows for recorded replay. The model (`ml/models/workload_classifier.joblib`), processed windows, raw-source dataset, and held-out predictions are local and git-ignored; summary metrics are written to `ml/reports/model_evaluation.json`.

Run the local API in a second terminal:

```sh
python -m uvicorn ml.api:app --reload --port 8000
```

Open **NEURO-ADAPT** in the frontend and choose a participant/task recording to replay model predictions and their probability timeline. These probabilities are uncalibrated model outputs, not reliable measures of mental state. The recorded-demo page does not claim live EEG input. Replay affects experience guidance gradually only after three consecutive scores exceed the experimental threshold and a cooldown; it never removes player choices or creative controls. `GET /api/model/status`, `GET /api/workload/sessions`, `POST /api/workload/predict`, `POST /api/workload/replay`, and `GET /api/workload/history` are available on the local API.

### Results and limitations

Model comparison uses participant-independent cross-validation. In the latest local run (6,063 windows from 16 participants), Gradient Boosting was selected with 47.6% accuracy and 46.8% macro F1; its per-class F1 was 63.0% (low), 31.6% (moderate), and 45.7% (high). Reported macro F1 is the pooled out-of-fold score; the held-out prediction file contains one prediction for each CV test window. Moderate-condition performance is weak, and the model's probability outputs have not been calibrated. This is a small, single-device benchmark and should not be treated as deployment validation. The task-condition labels may not represent subjective workload at each instant, and even a grouped-CV result is not evidence that the model generalizes to a new device or population.

The dataset includes Heat-the-Chair (documented low vs. moderate interruption conditions) and a five-flight simulator experiment, but the initial classifier uses N-back only because it has three explicit, repeated task-condition labels. Heat-the-Chair labels are binary and are not combined with N-back classes; simulator labels have only two pilots and broad mission annotations. Session-level NASA-TLX responses are not time-aligned and are not used as window labels.

The source dataset documents Emotiv EPOC X channels AF3, F7, F3, FC5, T7, P7, O1, O2, P8, T8, FC6, F4, F8, and AF4. ANT Neuro eego 24-channel data are not included or validated. A future adapter must verify electrode equivalence, reference/montage, sample rate, band-power definition and units, filtering, and channel ordering, then collect participant/device calibration data and repeat grouped validation before enabling live input. The saved model must not be presented as ANT Neuro compatible without that work.
