# Instinct (working name)

An EEG wearable that catches your involuntary "that's wrong" reaction while you read AI output, and turns it into feedback the AI learns from.

- **Flag:** an error-related potential (ErrP) plus a micro-frown, time-locked to each phrase.
- **Confirm:** a nod (fix) or a head shake (keep). One reading is ~70% reliable, so a human always confirms.
- **Translate:** an on-device small model (Ollama) turns the reaction into a plain-language request.
- **Learn:** ChatGPT rewrites only that phrase, and the confirmed preference is applied to future drafts.
- **Privacy:** raw EEG never leaves the device. Only text and reaction scores do.

The product form is over-ear EEG headphones: the band covers C3 · Cz · C4 and the cushions T7 / T8. The hackathon rig is the ANT Neuro eego 24-channel headset over LSL.

## Demo (3 min)

| Time | Beat |
|---|---|
| 0:00 | Hook: "AI learns from 👍. Your brain already knows when it's wrong." 3D device spins on **Profile**. |
| 0:15 | Sign in (`user@gmail.com` / `yo`). **Settings**: live headset (LSL) connected, quality dots green, *Signed in with ChatGPT*, calibrated, demo planted errors on. |
| 0:35 | **Session**: "Email my landlord Sarah about the broken heater." The draft is revealed one phrase every 1.5 s, with the live scalp map alongside. |
| 0:55 | "Dear Kevin," → reaction → amber flag → *"wrong name? Nod to fix"* → **nod** → ChatGPT rewrites → "Dear Sarah,". |
| 1:30 | "I demand this is dealt with immediately." → flag → *"too aggressive?"* → **nod** → rewritten. If a flag fires on a fine phrase → **shake** → kept. |
| 2:00 | "Note to my manager Priya about leaving early today." The draft comes back clean, and **Profile** shows what was learned. |
| 2:20 | **Profile**: neural preference dataset (CSV export) and public-data validation numbers. |
| 2:40 | Close: privacy, headphones form factor, alignment data for AI labs. |

Demo mode plants a wrong name and one confrontational line at the start of a phrase, because planted errors give the strongest, best time-locked reaction. Categories already learned are not planted again. This is stated in the app.

## Run

Needs Python 3.12, Node 20+, and [Ollama](https://ollama.com).

```sh
uv venv --python 3.12 .venv && uv pip install --python .venv/bin/python -r ml/requirements.txt
cp .env.example .env                      # add OPENAI_API_KEY
ollama serve & ollama pull llama3.2:3b     # on-device model (falls back to rules if absent)
.venv/bin/uvicorn ml.instinct.server:app --port 8100
cd instinct && npm install && npm run dev  # http://localhost:5174
```

The service starts on a **mock signal** (synthetic EEG that reacts to planted phrases), so everything works without hardware. It's labeled "mock signal" in the header.

**At the ANT station:** join the ANT network → **Settings → Live headset (LSL) → Connect** (picks the first `EEG` stream, or pass its name) → **Calibrate** (3 min) → **Session**.

Fallback keys, all labeled as simulated: `F` flags the current phrase, `Y` nods, `N` shakes.

## Rotation protocol (30 min)

1. Fit the headset and check that all quality dots are green in Settings.
2. **Record raw session** → **Calibrate** (full, 3 min) → run the demo script 3×, once with glasses → **Stop recording**. The recording is saved to `ml/instinct/recordings/`.
3. Note hits on planted phrases, false flags on clean phrases, and nod/shake accuracy (calibration metrics appear in Settings). Target: 2/2 planted hits per run, then tune.

## Validation

`python -m ml.instinct.validate_public` runs the live ErrP feature code, unchanged, on BNCI Horizon 013-2015 (6 people watching a cursor err, via MOABB). It uses only the channels our cap shares (Fz, F3, F4, C3, C4, Pz) and writes `ml/reports/errp_validation.json`, which the Profile tab displays.

| Setting | Balanced accuracy (chance 50%) |
|---|---|
| Same person, after calibration (5-fold CV) | **72%** (per person 66%–78%) |
| New person, no calibration (leave-one-subject-out) | **61%** |

6 people, 6418 trials, single trial. This is a lab cursor task, not reading, on a different headset. That's why every flag asks for a nod.

## How it works

```
eego (LSL, 500 Hz, 24 ch) → ring buffer → per-phrase epoch (−1…+1.6 s around onset)
  ├─ ErrP: 1–10 Hz mean amplitude at Fz F3 F4 C3 C4 Pz, 4 windows → shrinkage LDA
  └─ frown: 25–100 Hz RMS at Fp1 Fp2 F9 F10 vs rest baseline
  → reaction score = max(ErrP, frown); flagged ≥ 0.5
flagged → on-device SLM (rule check decides the category, SLM phrases the question)
        → nod/shake detector (0.3–4 Hz head-motion axes, two-sided swing, blinks rejected)
        → ChatGPT rewrite (text only) → SQLite preferences + dataset
```

| Path | What |
|---|---|
| `ml/instinct/` | `server.py` (FastAPI + WebSocket), `stream.py` (LSL / mock / CNT replay, recorder), `reaction.py`, `gestures.py`, `calibration.py`, `slm.py`, `llm.py`, `memory.py`, `synthetic.py`, `validate_public.py` |
| `instinct/` | React app: Profile / Session / Settings, `Device3D.tsx` (three.js), `ScalpMap.tsx`, `Calibration.tsx` |
| `ml/ant_neuro/` | CNT inspection and annotation tools for the first-rotation recordings |
| `docs/neuroverse-legacy.md` | The earlier Neuroverse demo (gaze painting, workload model) |

Tests: `.venv/bin/python -m pytest ml/instinct/tests`

## Limitations

- **A single reading is unreliable.** Every flag needs a nod; the value is aggregate signal over time.
- **ErrP is strongest at Cz/FCz**, which this cap lacks. Fz/C3/C4 are proxies.
- **Reading isn't a lab paradigm.** Reactions are only time-locked when the error starts a phrase, hence the planted errors in demo mode.
- **The frown is facial muscle, not brain activity.** It's involuntary and robust, and is presented as such.
- **Nod and shake are detected from head-motion artifacts.** They need per-person calibration and haven't been validated beyond our team.
- **The mock signal and the synthetic default model are stand-ins.** Live use requires calibration.
- **"Sign in with ChatGPT"** validates the OpenAI API key on the local service; it is not OAuth. The login is a hard-coded demo account.
