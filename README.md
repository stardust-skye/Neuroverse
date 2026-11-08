# Neuroverse

Neuroverse is a local-first neuro-art demo with a canvas-first Create mode and an optional adaptive Play challenge. Paint with a mouse or use experimental webcam-based eye-gaze controls.

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

Keyboard simulation is available outside the canvas:

| Key | Movement | Default action |
| --- | --- | --- |
| Space | Blink | Navigate / interact |
| A | Wink | Select |
| R | Rest | Return to neutral |

Inside Create and Play, the Color control is the initial gesture selection; blink to move to the next control and wink to select it. Calibrate eye gaze, then hold **Space** and look where you want to draw; release Space to stop. Mouse drawing remains available independently. Keyboard shortcuts are ignored while typing in an input, textarea, or select.

Create also has an opt-in receiver prepared for a future validated live EEG gesture model. With a fresh good-quality prediction, blink and wink predictions take priority over webcam gestures, and holding a detected jaw clench enables gaze drawing until release. A neutral jaw sample is required before starting, and drawing stops if the prediction becomes stale or the connection is lost. Gaze calibration and camera tracking are still required to position the brush. If predictions are unavailable, webcam gestures and Space drawing work as before without a fallback notice.

**The raw LSL bridge and existing model do not produce these gesture predictions**, and EEG gesture control has not been validated with ANT hardware. To connect a separately validated model and quality pipeline, set `VITE_GESTURE_EEG_URL` to its trusted WebSocket endpoint before starting Vite. It must send continuously, at least several times per second, JSON snapshots such as `{"type":"live_gestures","source":"live","quality":"good","timestamp":1730000000000,"blinkCount":0,"winkCount":0,"jawClenched":false}`. The Unix timestamp is in milliseconds; the nonnegative integer blink and wink counters increase once per recognized gesture and remain monotonic for the connection. The first snapshot establishes the baseline and does not trigger a gesture. Snapshots older than 1.5 seconds, malformed or poor-quality data, counter regressions and disconnections release EEG control. This contract does not validate the connected model or prove input provenance.

The app requests webcam permission automatically; allow access in the browser. The face-landmark task and WASM runtime are fetched from their published hosting URLs, so webcam mode needs an internet connection the first time it loads. Camera frames are processed in the browser, are not recorded, and are not sent to an application backend. Facial blink/wink and gaze detection are experimental; controlled human testing is still required. Webcam jaw-clench inference is disabled. The mirrored camera preview is hidden unless **DIAGNOSTICS** is open. Mouse drawing remains available if camera access or model loading fails.

EEG-based workload inference is explicitly marked as coming soon. Mindprint separately visualizes live raw EEG without claiming to infer emotions or workload.

## Experiences and persistence

- **Create:** A full-screen canvas with five brushes, color palette, brush sizing, undo/redo, clear confirmation, PNG export, and a locally saved gallery. Spray is the starting brush in both modes.
- **Play:** A moving gaze-painting target with a score and a fading paint trail.
- **Mindprint:** An evolving generative artwork driven by live EEG sample patterns, opened from the studio top bar.
- Artwork and input settings are stored in browser local storage.

In **Create** or **Play**, select the crosshair calibration button. For each of the nine targets, press **Space** or **Capture**, then look at the target while the app records your eyes. Sampling begins after a short delay, so you have time to look back at the target; slow or noisy samples get extra time. If a point does not fit the others, the app asks you to retry that point. Play adaptation pauses during calibration. If calibration still fails, check that your eyes are visible, improve lighting, and retry. Hold Space to draw with the calibrated eye-gaze cursor; releasing it stops drawing. Tracking loss pauses drawing. The diagnostics panel reports face status, raw head-pose features, normalized gaze cursor position, and recognized gestures; it can also reveal the mirrored webcam preview. **PLAY ART / STOP ART** animates recorded spray and particle dots with shimmering glow and motion trails on an overlay without changing the saved canvas. Dots in older artwork saved before particle recording remain static.

Horizontal gaze output is flipped by default for the current setup, after calibration. If looking left moves the cursor right or vice versa, use the horizontal-flip button beside the calibration crosshair to switch direction. The choice is saved locally and applies in Create and Play; it does not change vertical gaze, the camera preview, or calibration samples.

### Mindprint live EEG art

The `test_lsl_connection` diagnostic checks one batch and exits; it does not limit the headset stream. To forward ongoing batches, start the live bridge on the computer running the browser, with the eego LSL stream discoverable on the network:

```powershell
.\venv\Scripts\python.exe -m pip install -r ml\requirements.txt
.\venv\Scripts\python.exe -m ml.live.lsl_ws_bridge --name "EE225-020034-000345_on_DESKTOP-ET4GTF5"
```

Use the exact stream name printed by the diagnostic if it changes. Keep the bridge running and start the frontend separately with `npm run dev`. Open **MINDPRINT** in Create or Play. The first second establishes a session reference, so start with a comfortable relaxed face. Afterward, the art responds to signal amplitude and waveform changes in the latest half-second, updating about four times a second; **SAVE ART** downloads the current frame. The reference resets when the stream is lost or Mindprint is reopened. The bridge defaults to `ws://localhost:8765`; set `VITE_MINDPRINT_EEG_URL` before starting Vite to use a different trusted bridge. Mindprint stops displaying and saving the artwork when samples become stale or the connection is lost. The bridge's explicitly named `SIMULATED` stream is rejected.

The bridge forwards all raw channels and their supplied types to consumers. Mindprint uses only channels whose metadata type is `Referential` or `EEG`; unknown types and trigger channels are excluded, and a stream with no identified EEG channels is rejected. The provided diagnostic output reported 24 `Referential` channels and one `TRG` trigger at 1,000 Hz for this particular stream. Verify metadata again if the configuration changes. Mindprint is a procedural visualization, not a trained EEG-to-image model or a medical or emotional interpretation. Signal changes from movement or muscle activity may influence the art, but no particular action is identified and there is no guarantee every movement will produce a measurable response. The browser trusts the configured bridge and cannot independently prove that a stream is genuine EEG. Live hardware behavior has not been validated; no webcam data is used to generate Mindprint.

For a first-time studio session: allow camera access in even lighting, select the crosshair, and capture each target while looking at it. Hold Space while checking cursor travel and alignment in **DIAGNOSTICS**. This software-only mapping check does not establish real-world tracking quality; controlled human validation is still required. If camera access is blocked, use the mouse; never treat pointer movement as webcam tracking.

### Gaze and gesture validation checklist

- Automated: `npm run test:frontend` checks gaze mapping, outlier rejection, smoothing, gesture timing, particle movement, stroke controls, and challenge behavior.
- Human-required: with a real person, check gaze calibration, cursor travel for all four directions, face-loss pause, preview/landmark/cursor consistency, and controlled blink/wink trials. Repeat in the intended demo lighting. No controlled human validation is claimed.

**Play Mode** has a green target and no rounds, timer, or coverage score. After calibration, hold Space and move the gaze cursor into or across the box; contact immediately adds one point, makes the next box slightly smaller, and moves it to another position. Paint fades away over two seconds and is not saved to the Create canvas. A configured, fresh live stress prediction takes precedence: sustained stress gradually enlarges the box, while relaxed predictions leave normal play unchanged. If a valid live prediction is unavailable, sustained eyebrow scrunching gradually enlarges the box instead. Mouse painting remains available but does not count toward gaze success. Entering Play again resets the box and score. Eyebrow movement is an experimental facial gesture, **not a measurement of stress**. Facial blendshape detection and gaze accuracy vary by person, lighting, and camera and have not been validated with real users.

The eyebrow fallback responds after approximately 0.6 seconds of a sustained scowl and keeps growing the target until release or its maximum size. In **DIAGNOSTICS**, adjust **Play scowl threshold** lower for a gentler scowl, or higher if a relaxed face causes unwanted growth. This affects the camera fallback, not EEG priority.

### Play live EEG integration status

The EEG-first **receiver is prepared, but live EEG stress inference is not implemented or validated**. The eego LSL stream contains raw samples, not stress predictions. The existing trained model expects 140 features from 14-channel Emotiv precomputed band powers and predicts N-back task conditions; it cannot safely be fed the 24-channel 500 Hz ANT stream or presented as a stress classifier. See [the compatibility investigation](./ml/ant_neuro/reports/live-stream-model-compatibility.md). The raw LSL WebSocket bridge does not produce the prediction contract below.

Once an independently validated compatible live model and signal-quality pipeline exist, explicitly configure the frontend at startup with `VITE_PLAY_EEG_SCORE_URL` pointing to its trusted WebSocket endpoint. It must send JSON objects such as `{"type":"live_stress","source":"live","quality":"good","state":"stressed","timestamp":1730000000000}`, where `timestamp` is the current Unix time in milliseconds and `state` is `stressed` or `relaxed`. Send updated predictions at least every five seconds. Stale, malformed, poor-quality, replay, and disconnected inputs cannot drive Play; the camera fallback is used instead. No endpoint is enabled by default, and merely connecting raw LSL samples does not enable EEG adaptation.

## Sensor architecture and current capability

Facial gesture timing is implemented in `src/gestures.ts`; gaze estimation and calibration are in `src/gaze.ts`; blink/wink actions are in `src/gestureController.ts`; challenge adaptation is in `src/challenge.ts`; and stroke history is in `src/strokes.ts`. The ANT Neuro CNT files are only locally inspected and annotated; the current recordings do not contain reviewed sample-level gesture labels. No EEG gesture classifier or live EEG adapter exists. The local FastAPI service supports recorded UAB workload replay only; it is not a live headset stream. The standalone LSL diagnostic below does not feed the application or its model. The frontend and backend explicitly distinguish recorded replay from live input.

### Hardware validation before a live demo

Automated tests cover synthetic gaze mapping and interaction rules, not a physical webcam or EEG headset. Before presenting, test camera permission/startup, face and landmark status, gaze calibration, cursor travel in all four directions, center return, cursor/paint alignment, and blink/wink behavior at the chosen sensitivity in the intended room lighting. Confirm mouse fallback if the camera is denied. Live ANT Neuro streaming is unavailable: the project has no vendor/LSL acquisition process, stream reader, device metadata/quality path, or live prediction transport. `/api/workload/replay` is the production model's recorded-data inference path; live hardware values are not currently sent to the frontend.

### Workload data and interpretation

- **Current primary local dataset:** UAB N-back, already in `workload_dataset/`. It has 16 participants, 14 Emotiv EPOC X channels, and task-condition classes (position 1-back, arithmetic 1-back, dual arithmetic 2-back). These labels are not subjective instantaneous workload or stress ratings. Existing grouped evaluation is 5-fold by participant; the Gradient Boosting baseline is 47.6% accuracy and 46.8% macro F1 across 6,063 windows. See [the baseline metrics](./ml/reports/model_evaluation.json) and [foundation-model experiment status](./ml/reports/foundation_model_comparison.md).
- **STEW candidate:** 48 participants, 14 Emotiv EPOC channels at 128 Hz, 2.5-minute rest/task recordings, and separate 1–9 perceived-workload ratings. The official IEEE DataPort listing requires account access to download. It is the closer future option for ratings and headset montage, but has not been downloaded, checked for licensing terms, or validated against the current headset firmware.
- **PhysioNet 2026 stress-resilience candidate:** 35 analyzed participants using a g.tec 32-channel hybrid EEG-fNIRS setup at 250 Hz, with six task phases (resting baseline, working baseline, stress 1, recovery 1, stress 2, recovery 2) and synchronized multimodal recordings. These are experimental phases, not direct moment-to-moment stress ratings. Its montage and acquisition differ from the ANT Neuro setup; downloads were not attempted because the per-participant grouped data are large (the listing says each grouped folder is under 10 GB). No stress model is trained from these labels.

The current UAB task-condition model may be used only as a **cognitive-workload task-condition proxy** in recorded replay. It is not relabeled as stress or used to change the live challenge. The source recordings remain unchanged. The headset's supported live streaming/API route has not been verified on this machine; a future integration needs vendor/LSL access and device-specific validation.

## Known limitations

- Head-pose control uses a neutral-pose sample and heuristic landmark features; it is not a validated gaze tracker or rigid pose solver. Synthetic mapping tests do not validate real-person direction or accuracy.
- Blink/wink and double-blink thresholds are configurable experimental defaults, not user-personalized models; selection reliability needs human validation.
- EEG workload estimation is recorded-replay only. Live ANT Neuro strain, signal quality, and resting-baseline calibration are not implemented.
- EEG jaw-clench detection is disabled; the ANT Neuro gesture recordings need reviewed event intervals before a gesture model can be evaluated.
- Play uses camera eyebrow movement, not an EEG strain model, to make its target easier.
- Webcam model/runtime assets are hosted externally and are fetched only after the user enables webcam mode.
- There is no account or cloud sync. Saved artwork and its vector-like stroke history are stored in browser local storage.

## NEURO-ADAPT workload demo

The optional Python pipeline lives in `ml/` and reads the original dataset in `workload_dataset/` without changing it. It trains on N-back **task-condition labels** only: test 1 is the documented low-workload position 1-back condition, test 2 is moderate arithmetic 1-back, and test 3 is high dual arithmetic 2-back. These are experimental task labels, not direct measurements or diagnoses of a participant’s internal mental state. The included dataset README does not define the numeric `phase` values; the pipeline uses phase 2 as the likely task interval based on its timing. Confirm that mapping against the original protocol before interpreting results.

### ANT Neuro gesture annotation

To check an independently running LSL source, install `pylsl` in the project
virtual environment if necessary, then run from the project root:

```powershell
.\venv\Scripts\python.exe ml\ant_neuro\test_lsl_connection.py
```

The diagnostic discovers streams for up to 30 seconds, then checks the first
stream whose type is EEG for full channel metadata and samples for up to 10
seconds. To choose a specific EEG source, add `--stream-name` followed by its
exact name. The producer may omit channel names, types, or units; missing
metadata must not be inferred. Receiving samples does not establish model
compatibility or connect them to the application.

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
