# CLAUDE.md

Hackathon project, ANT Neuro movement track. **Instinct** (working name, set in `instinct/src/brand.ts`) uses EEG to catch a reader's involuntary "that's wrong" reaction while they read ChatGPT output. A nod confirms, ChatGPT rewrites the phrase, and the preference is learned. Product framing, demo script and results are in `README.md`.

## Run

```sh
uv venv --python 3.12 .venv && uv pip install --python .venv/bin/python -r ml/requirements.txt
cp .env.example .env                       # OPENAI_API_KEY (the user uses OpenAI/ChatGPT, not Anthropic)
ollama serve & ollama pull llama3.2:3b      # on-device SLM; rule fallback if absent
.venv/bin/uvicorn ml.instinct.server:app --port 8100
cd instinct && npm install && npm run dev   # http://localhost:5174 — login user@gmail.com / yo
```

- Use `.venv` (Python 3.12). The system Python 3.15 has no numpy/scipy wheels.
- Tests: `.venv/bin/python -m pytest ml/instinct/tests` and `cd instinct && npx tsc --noEmit -p .`
- Public validation: `.venv/bin/python -m ml.instinct.validate_public` (downloads about 640 MB through MOABB).
- Git: `origin` is HTTPS. Credentials come from `gh` (account RameezMilk), set in the repo-local config. The SSH key on this machine belongs to a different account without access.

## Architecture

- `ml/instinct/server.py`: FastAPI REST + a single `/ws` WebSocket. Its `Engine` loop runs every 50 ms: pull from the source → ring buffer → score pending phrase epochs → detect nod/shake while a question is open → broadcast signals at 10 Hz.
- Sources (`stream.py`): `LslSource` (live eego, channels selected by label), `SyntheticSource` (mock; injects reactions at planted phrases), `ReplaySource` (`.cnt`). `Recorder` saves raw data and markers to `ml/instinct/recordings/`.
- `reaction.py`: per-phrase score = max(ErrP LDA probability, frown sigmoid). It's flagged at ≥ 0.5.
  - ErrP: 1–10 Hz at Fz/F3/F4/C3/C4/Pz, baseline-corrected, mean amplitude in 4 windows from 0.2 to 1.0 s.
  - Frown: 25–100 Hz RMS at Fp1/Fp2/F9/F10 divided by the rest RMS; default threshold 2.5×.
  - Features are normalised by rest statistics, so the score doesn't depend on the stream's units.
- `gestures.py`: nod vs shake on 0.3–4 Hz vertical (Fp − O) vs horizontal (left − right temporal) axes. Requires motion about 8× rest, a dominant axis and a two-sided swing (rejects blinks).
- `calibration.py`: fits a per-wearer profile from markers (rest, 40 cursor ErrP trials, frowns, nods, shakes). Saved per user for LSL only.
- `slm.py`: rule checks decide the issue category (wrong name, aggressive wording); Ollama only phrases the question and request. The 3B model mislabels when left to decide alone.
- `llm.py`: OpenAI with `reasoning_effort="minimal"` (GPT-5 drafts took 55 s without it). Startup connection is non-blocking. Demo mode plants a wrong name and one aggressive line at a sentence boundary, skipping categories already learned. There is an offline fallback.
- `memory.py`: SQLite with preferences and a reaction dataset; the CSV export is anonymised.
- `instinct/src/`: `Session.tsx` (reveal loop: one chunk every 1.5 s, sends an `onset` marker; question card; keys F/Y/N labelled as simulated), `Settings.tsx`, `Profile.tsx`, `Calibration.tsx`, `ScalpMap.tsx`, and `Device3D.tsx` wrapped in `SafeDevice.tsx` (WebGL errors must not crash the app).
- `ml/ant_neuro/`: CNT inspection and annotation from the first rotation. The `.cnt` files are git-ignored and not on this laptop.

## Principles

- **Label everything honestly.** Mock signal, simulated keys and offline drafts are marked as such in the UI. Never present the mock signal as live EEG.
- **The frown and nod/shake are muscle and head-motion signals, not brain activity.** Only the ErrP is cortical. Keep that distinction in the UI and the pitch.
- **One reading isn't reliable.** Public validation: 72% within-person, 61% cross-person, on a cursor task, not reading. Every flag asks for a nod.

## Open work (agreed, not built)

The user wants a **live, unscripted demo on real brain data**. Next steps, in priority order:
1. **Reading-based calibration:** about 60 sentences, 20% containing errors, in the demo format. It replaces or extends the cursor task.
2. **Live random flaws:** ChatGPT inserts one flaw of a random type at a random position and returns its index, replacing the hardcoded "Kevin" and "I demand…" lines. Keep a "pure" toggle with no flaw.
3. **Live averaged ERP panel:** the Fz/C-region waveform for flagged vs normal phrases, updating during the session.
4. **Pace setting** (2 s per phrase) and a **sensitivity slider** for the 0.5 threshold.
5. **Retrain from recordings:** fit the profile from `ml/instinct/recordings/*.npz`.
6. **Brain-only toggle:** score from the ErrP alone, with the frown shown but not counted.

Hardware unknowns to resolve at the ANT station:
- Does the ErrP appear during natural reading at all? This is the go/no-go test.
- The LSL stream's name, labels and units.
- Whether the ANT network has internet. If not, ChatGPT needs a second link such as a tethered phone.
- Whether the headset can come to the presentation room.
