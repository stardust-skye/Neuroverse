# Neuroverse

Neuroverse is a local-first interactive entertainment demo. Explore a branching story, care for a digital moon sprite, or make generative artwork using keyboard input or optional webcam-based facial landmarks.

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

## Inputs

Keyboard simulation is always available:

| Key | Movement | Default action |
| --- | --- | --- |
| Space | Blink | Confirm / interact |
| A | Wink | Switch / change |
| S | Jaw clench | Special action |
| R | Rest | Return to neutral |

Keyboard shortcuts are ignored while typing in an input, textarea, or select. Controls work in each experience and can also be tested in the setup screen or developer panel (`Ctrl+Shift+D`). Movement-to-action mappings can be changed on the setup screen and are saved in local storage.

Webcam mode is optional. Select it in setup and explicitly enable the camera; grant browser permission when prompted. The face-landmark task and WASM runtime are fetched from their published hosting URLs, so webcam mode needs an internet connection the first time it loads. Camera frames are processed in the browser, are not recorded, and are not sent to an application backend. Eye-closure detection is experimental. Jaw clench is approximated using mouth landmarks and is not a reliable measurement of muscle contraction. Keyboard simulation remains available if camera access or model loading fails.

EEG mode is explicitly marked as coming soon. The project does not claim or simulate an EEG hardware connection.

## Experiences and persistence

- **The Last Signal:** A playable branching story with multiple endings.
- **Miso:** A pet with needs, levels, reactions, and a locally saved interaction history.
- **Generative studio:** A continuously animated canvas with palette and pattern controls, PNG export, and a local gallery.
- Pet progress, artwork, and input mappings are stored in the browser's local storage.

## Future EEG integration

The shared movement event contract is defined in `src/types.ts`. A future EEG adapter can translate messages from an ANT Neuro → LSL → Python processing/model → WebSocket pipeline into this contract and publish them through the app's movement dispatcher. Keep that adapter separate from `src/WebcamInput.tsx`; neither source should require changes inside the story, pet, or canvas experiences.

## Known limitations

- Webcam thresholds are fixed experimental defaults and are not personalized through a completed calibration routine.
- The jaw-clench event is a mouth-opening proxy, which cannot reliably distinguish a clench from other facial movement.
- Webcam model/runtime assets are hosted externally and are fetched only after the user enables webcam mode.
- This is a frontend-only demo; there is no account, cloud sync, or real EEG device integration.

## NEURO-ADAPT workload demo

The optional Python pipeline lives in `ml/` and reads the original dataset in `workload_dataset/` without changing it. It trains on N-back **task-condition labels** only: test 1 is the documented low-workload position 1-back condition, test 2 is moderate arithmetic 1-back, and test 3 is high dual arithmetic 2-back. These are experimental task labels, not direct measurements or diagnoses of a participant’s internal mental state. The included dataset README does not define the numeric `phase` values; the pipeline uses phase 2 as the likely task interval based on its timing. Confirm that mapping against the original protocol before interpreting results.

The current dataset contains 16 documented N-back participants and 48 participant/task recordings, with Emotiv EPOC X 14-channel signals. A sample timestamp analysis estimates about 126.9 Hz for raw rows; the dataset authors' processing code declares a 128 Hz raw rate and 8 Hz power-feature rate. The recordings include vendor-provided Theta, Alpha, BetaL, BetaH, and Gamma band-power columns, with undocumented units. Ten-second windows use the provided band powers; no raw-signal filtering is applied. Features are standardized inside each training fold only.

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

Open **NEURO-ADAPT** in the frontend and choose a participant/task recording to replay actual model predictions and their probability timeline. The recorded-demo page does not claim live EEG input. Replay affects experience guidance gradually only after three consecutive predictions above the confidence threshold and a cooldown; it never removes player choices or creative controls. `GET /api/model/status`, `GET /api/workload/sessions`, `POST /api/workload/predict`, `POST /api/workload/replay`, and `GET /api/workload/history` are available on the local API.

### Results and limitations

Model comparison uses participant-independent cross-validation. Reported macro F1 is the pooled out-of-fold score; the held-out prediction file contains one prediction for each CV test window. This is a small, single-device benchmark and should not be treated as deployment validation. The task-condition labels may not represent subjective workload at each instant, and even a grouped-CV result is not evidence that the model generalizes to a new device or population.

The dataset includes Heat-the-Chair (documented low vs. moderate interruption conditions) and a five-flight simulator experiment, but the initial classifier uses N-back only because it has three explicit, repeated task-condition labels. Heat-the-Chair labels are binary and are not combined with N-back classes; simulator labels have only two pilots and broad mission annotations. Session-level NASA-TLX responses are not time-aligned and are not used as window labels.

The source dataset documents Emotiv EPOC X channels AF3, F7, F3, FC5, T7, P7, O1, O2, P8, T8, FC6, F4, F8, and AF4. ANT Neuro eego 24-channel data are not included or validated. A future adapter must verify electrode equivalence, reference/montage, sample rate, band-power definition and units, filtering, and channel ordering, then collect participant/device calibration data and repeat grouped validation before enabling live input. The saved model must not be presented as ANT Neuro compatible without that work.
