"""Instinct local service: EEG stream -> reaction/gesture events -> on-device SLM -> ChatGPT.

Run: uvicorn ml.instinct.server:app --port 8100
Raw EEG stays in this process. Only text (draft chunks and rewrite requests) goes to OpenAI.
"""

from __future__ import annotations

import asyncio
import json
import os
from contextlib import asynccontextmanager
from pathlib import Path

import numpy as np
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel
from scipy.signal import butter, sosfiltfilt

from ml.instinct import calibration, llm, slm
from ml.instinct.gestures import WINDOW_S, GestureModel
from ml.instinct.memory import Memory
from ml.instinct.reaction import POST_S, PRE_S, RestStats, default_model
from ml.instinct.stream import LslSource, RingBuffer, Recorder, ReplaySource, SyntheticSource, clock
from ml.instinct.synthetic import (errp_waveform, frown_waveform, nod_waveform, shake_waveform)

ROOT = Path(__file__).resolve().parents[2]
VALIDATION = ROOT / "ml" / "reports" / "errp_validation.json"
USER = "user@gmail.com"

try:
    from dotenv import load_dotenv
    load_dotenv(ROOT / ".env")
except ImportError:
    pass


class Engine:
    def __init__(self):
        self.memory = Memory()
        self.clients: set[WebSocket] = set()
        self.markers: list[dict] = []
        self.calibrating = False
        self.recorder = Recorder()
        self.mock_auto_react = True
        self.use(SyntheticSource())

    def use(self, source) -> None:
        self.source = source
        self.sfreq = source.sfreq
        self.buffer = RingBuffer(len(source.channels), source.sfreq)
        self.pending: list[dict] = []
        self.awaiting: dict | None = None
        self.baseline_rms: np.ndarray | None = None
        self.started = clock()
        profile = calibration.load(USER) if source.kind == "lsl" else None
        if profile:
            self.reaction, self.gestures = profile["reaction"], profile["gestures"]
            self.baseline = "calibrated"
        else:
            self.reaction = default_model(self.sfreq)
            from ml.instinct.synthetic import BackgroundEEG
            self.gestures = GestureModel.from_rest(BackgroundEEG(self.sfreq, seed=11).generate(int(20 * self.sfreq)),
                                                   self.sfreq)
            # Live/replay data: re-estimate rest statistics from the first 20 s of the real signal.
            self.baseline = "synthetic" if source.kind == "mock" else "collecting"

    @property
    def simulated_source(self) -> bool:
        return self.source.kind == "mock"

    async def broadcast(self, message: dict) -> None:
        for ws in list(self.clients):
            try:
                await ws.send_text(json.dumps(message))
            except Exception:
                self.clients.discard(ws)

    def status(self) -> dict:
        return {
            "source": self.source.kind,
            "stream_name": getattr(self.source, "stream_name", None),
            "sfreq": self.sfreq,
            "channels": list(self.source.channels),
            "baseline": self.baseline,
            "reaction_model": self.reaction.source,
            "gesture_model": self.gestures.source,
            "calibration_metrics": self.reaction.metrics,
            "recording": self.recorder.active,
            "slm": slm.status(),
            "chatgpt": {"connected": llm.model_name() is not None, "model": llm.model_name()},
        }

    # ---- stream loop -------------------------------------------------------
    async def run(self) -> None:
        tick = 0
        while True:
            await asyncio.sleep(0.05)
            tick += 1
            try:
                data, times = self.source.pull()
            except Exception as error:
                await self.broadcast({"type": "error", "message": f"Stream read failed: {error}"})
                continue
            self.buffer.push(data, times)
            self.recorder.add(data, times)
            if self.baseline == "collecting" and clock() - self.started > 20:
                rest = self.buffer.last(18.0)
                if rest is not None:
                    self.reaction.rest = RestStats.from_rest(rest, self.sfreq, self.source.channels)
                    self.gestures = GestureModel.from_rest(rest, self.sfreq, self.source.channels)
                    self.baseline = "live-rest"
                    await self.broadcast({"type": "status", "status": self.status()})
            await self.score_pending()
            if tick % 4 == 0:
                await self.detect_gesture()
            if tick % 2 == 0:
                await self.send_signals()

    async def score_pending(self) -> None:
        ready = [p for p in self.pending if self.buffer.latest >= p["onset"] + POST_S]
        for item in ready:
            self.pending.remove(item)
            epoch = self.buffer.window(item["onset"] - PRE_S, item["onset"] + POST_S)
            if epoch is None:
                continue
            reading = self.reaction.score(epoch, self.sfreq, self.source.channels)
            await self.emit_reaction(item, reading, simulated=False)

    async def emit_reaction(self, item: dict, reading: dict, simulated: bool) -> None:
        reaction_id = self.memory.add_reaction(USER, item.get("request", ""), item.get("text", ""), reading,
                                               simulated or self.simulated_source)
        message = {"type": "reaction", "chunk_id": item["chunk_id"], "reaction_id": reaction_id,
                   "reading": reading, "simulated": simulated, "source": self.source.kind}
        if reading["flagged"]:
            message["interpretation"] = await asyncio.to_thread(
                slm.interpret, item.get("text", ""), item.get("draft", ""), item.get("request", ""), reading)
        await self.broadcast(message)

    async def detect_gesture(self) -> None:
        if not self.awaiting:
            return
        start = max(self.awaiting["since"], self.buffer.latest - WINDOW_S)
        if self.buffer.latest - start < WINDOW_S * 0.95:
            return
        window = self.buffer.window(self.buffer.latest - WINDOW_S, self.buffer.latest)
        if window is None:
            return
        found = self.gestures.detect(window, self.sfreq, self.source.channels)
        if found:
            chunk_id = self.awaiting["chunk_id"]
            self.awaiting = None
            await self.broadcast({"type": "gesture", "chunk_id": chunk_id, "simulated": False,
                                  "source": self.source.kind, **found})

    async def send_signals(self) -> None:
        window = self.buffer.last(1.0)
        if window is None:
            return
        sos = butter(2, (1.0, min(40.0, self.sfreq / 2 - 5)), btype="bandpass", fs=self.sfreq, output="sos")
        rms = np.sqrt(np.mean(sosfiltfilt(sos, window, axis=-1) ** 2, axis=1)) + 1e-15
        if self.baseline_rms is None:
            self.baseline_rms = rms.copy()
        self.baseline_rms = 0.98 * self.baseline_rms + 0.02 * np.minimum(rms, self.baseline_rms * 3)
        ratio = rms / self.baseline_rms
        activity = np.clip(0.25 + 0.75 * np.log(ratio) / np.log(6.0), 0, 1)
        typical = float(np.median(rms))
        quality = ["flat" if r < typical * 0.02 else "noisy" if r > typical * 12 else "good" for r in rms]
        names = self.source.channels
        await self.broadcast({"type": "signals",
                              "activity": {n: round(float(a), 3) for n, a in zip(names, activity)},
                              "quality": dict(zip(names, quality))})

    # ---- messages from the app --------------------------------------------
    async def handle(self, message: dict) -> None:
        kind = message.get("type")
        now = clock()
        if kind == "onset":
            item = {**message, "onset": now}
            self.pending.append(item)
            self.recorder.mark({"kind": "onset", "t": now, "chunk_id": message.get("chunk_id"),
                                "planted": message.get("planted")})
            if self.simulated_source and self.mock_auto_react and message.get("planted"):
                if message["planted"] != "stray":
                    self.source.inject(errp_waveform(self.sfreq, amplitude_uv=9.0), at=now + 0.15)
                self.source.inject(frown_waveform(self.sfreq), at=now + 0.15)
        elif kind == "await_gesture":
            self.awaiting = {"chunk_id": message.get("chunk_id"), "since": now + 0.3}
        elif kind == "cancel_await":
            self.awaiting = None
        elif kind == "simulate":
            await self.simulate(message)
        elif kind == "cal_marker":
            marker = {"kind": message["kind"], "label": message.get("label", 0), "t": now}
            self.markers.append(marker)
            self.recorder.mark(marker)
            if self.simulated_source:
                if marker["kind"] == "trial" and marker["label"]:
                    self.source.inject(errp_waveform(self.sfreq, amplitude_uv=8.0), at=now + 0.1)
                elif marker["kind"] == "frown":
                    self.source.inject(frown_waveform(self.sfreq), at=now + 0.1)
                elif marker["kind"] in ("nod", "shake"):
                    wave = nod_waveform if marker["kind"] == "nod" else shake_waveform
                    self.source.inject(wave(self.sfreq), at=now + 0.3)

    async def simulate(self, message: dict) -> None:
        """Keyboard fallbacks. In mock mode they drive the real detectors; live, they are labelled simulated."""
        what = message.get("what")
        if what in ("nod", "shake"):
            if self.simulated_source and self.awaiting:
                wave = nod_waveform if what == "nod" else shake_waveform
                self.source.inject(wave(self.sfreq), at=clock())
            else:
                chunk_id = self.awaiting["chunk_id"] if self.awaiting else message.get("chunk_id")
                self.awaiting = None
                await self.broadcast({"type": "gesture", "gesture": what, "chunk_id": chunk_id,
                                      "simulated": True, "source": self.source.kind})
        elif what == "reaction":
            item = {"chunk_id": message.get("chunk_id"), "text": message.get("text", ""),
                    "draft": message.get("draft", ""), "request": message.get("request", "")}
            self.pending = [p for p in self.pending if p.get("chunk_id") != item["chunk_id"]]
            reading = {"score": 1.0, "errp": 0.0, "frown": 0.0, "frown_ratio": 0.0, "flagged": True}
            await self.emit_reaction(item, reading, simulated=True)


engine = Engine()


@asynccontextmanager
async def lifespan(_app):
    task = asyncio.create_task(engine.run())
    # Never block startup on the network: connect to OpenAI in the background.
    connecting = asyncio.create_task(asyncio.to_thread(llm.connect))
    yield
    task.cancel()
    connecting.cancel()


app = FastAPI(title="Instinct local service", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["http://127.0.0.1:5174", "http://localhost:5174"],
                   allow_methods=["GET", "POST"], allow_headers=["Content-Type"])


class DeviceRequest(BaseModel):
    mode: str = "mock"           # mock | lsl | replay
    name: str | None = None      # LSL stream name (optional)
    path: str | None = None      # .cnt path for replay


class DraftRequest(BaseModel):
    request: str
    plant: bool = True


class RewriteRequest(BaseModel):
    request: str
    chunks: list[str]
    index: int
    instruction: str
    category: str = "other"


class DecisionRequest(BaseModel):
    reaction_id: int
    decision: str                # accept | keep
    category: str | None = None


@app.get("/status")
def status():
    return engine.status()


@app.post("/device")
async def device(body: DeviceRequest):
    try:
        if body.mode == "lsl":
            source = await asyncio.to_thread(LslSource, "EEG", body.name)
        elif body.mode == "replay":
            path = Path(body.path) if body.path else next(iter(sorted(ROOT.glob("*.cnt"))), None)
            if not path or not path.is_file():
                raise RuntimeError("No .cnt recording found for replay.")
            source = await asyncio.to_thread(ReplaySource, path)
        else:
            source = SyntheticSource()
    except Exception as error:
        raise HTTPException(status_code=503, detail=str(error))
    engine.use(source)
    await engine.broadcast({"type": "status", "status": engine.status()})
    return engine.status()


@app.post("/auth/chatgpt")
async def chatgpt_connect():
    return await asyncio.to_thread(llm.connect)


@app.post("/draft")
async def draft(body: DraftRequest):
    learned = engine.memory.learned_categories()
    result = await asyncio.to_thread(llm.draft, body.request, engine.memory.preferences(), body.plant, learned)
    if body.plant and not learned and len(result["chunks"]) > 6:
        stray = len(result["chunks"]) - 3       # one clean chunk the mock "misreads", to show a shake
        if result["chunks"][stray]["planted"] is None:
            result["chunks"][stray]["planted"] = "stray"
    return result


@app.post("/rewrite")
async def rewrite(body: RewriteRequest):
    if not 0 <= body.index < len(body.chunks):
        raise HTTPException(status_code=422, detail="index out of range")
    return await asyncio.to_thread(llm.rewrite, body.request, body.chunks, body.index, body.instruction,
                                   body.category, engine.memory.preferences())


@app.post("/decision")
def decision(body: DecisionRequest):
    if body.decision not in ("accept", "keep"):
        raise HTTPException(status_code=422, detail="decision must be accept or keep")
    engine.memory.decide(body.reaction_id, body.decision, body.category)
    return {"preferences": engine.memory.preferences()}


@app.get("/profile")
def profile():
    validation = json.loads(VALIDATION.read_text()) if VALIDATION.is_file() else None
    reactions = engine.memory.reactions(100)
    flagged = [r for r in reactions if r["flagged"]]
    return {"user": USER, "preferences": engine.memory.preferences(), "reactions": reactions,
            "stats": {"chunks_read": len(reactions), "flagged": len(flagged),
                      "confirmed": sum(r["decision"] == "accept" for r in flagged),
                      "overridden": sum(r["decision"] == "keep" for r in flagged)},
            "validation": validation, "calibration": engine.reaction.metrics}


@app.get("/dataset.csv", response_class=PlainTextResponse)
def dataset():
    return PlainTextResponse(engine.memory.export_csv(), media_type="text/csv",
                             headers={"Content-Disposition": "attachment; filename=instinct-neural-preferences.csv"})


@app.post("/calibrate/start")
def calibrate_start():
    engine.markers = []
    engine.calibrating = True
    return {"ok": True}


@app.post("/calibrate/finish")
def calibrate_finish():
    engine.calibrating = False
    try:
        reaction, gestures, metrics = calibration.fit_profile(engine.buffer, engine.markers,
                                                              engine.source.channels, engine.sfreq)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error))
    engine.reaction, engine.gestures, engine.baseline = reaction, gestures, "calibrated"
    if engine.source.kind == "lsl":
        calibration.save(USER, reaction, gestures)
    return {"metrics": metrics, "status": engine.status()}


@app.post("/record/{action}")
def record(action: str):
    if action == "start":
        engine.recorder.start()
        return {"recording": True}
    path = engine.recorder.stop(engine.sfreq, engine.source.channels)
    return {"recording": False, "saved": str(path) if path else None}


@app.post("/reset")
def reset():
    engine.memory.reset()
    return {"ok": True}


@app.websocket("/ws")
async def websocket(ws: WebSocket):
    await ws.accept()
    engine.clients.add(ws)
    await ws.send_text(json.dumps({"type": "status", "status": engine.status()}))
    try:
        while True:
            await engine.handle(json.loads(await ws.receive_text()))
    except WebSocketDisconnect:
        engine.clients.discard(ws)


if os.environ.get("INSTINCT_NO_MOCK_REACT"):
    engine.mock_auto_react = False
