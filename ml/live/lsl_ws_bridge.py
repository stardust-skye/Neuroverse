"""Bridge a live LSL EEG stream (e.g. from the ANT Neuro eego software) to browsers.

Usage (from the Neuroverse project root, venv active):
    python -m ml.live.lsl_ws_bridge                 # first LSL stream of type EEG
    python -m ml.live.lsl_ws_bridge --name "eego"   # pick a stream by name
    python -m ml.live.lsl_ws_bridge --simulate      # fake 8-ch data, no headset needed

Browser connects to ws://localhost:8765 and receives JSON:
    {"type": "meta", "name", "srate", "channels": [...labels]}
    {"type": "samples", "t0": <lsl time of first sample>, "data": [[ch1..chN], ...]}
    {"type": "status", "state": "waiting" | "streaming"}
"""
import argparse
import asyncio
import json
import math
import time

import websockets

BATCH_HZ = 30  # how often we push batches to the browser

clients: set = set()
meta: dict = {"type": "meta", "name": "none", "srate": 0, "channels": []}


async def handler(ws):
    clients.add(ws)
    try:
        await ws.send(json.dumps(meta))
        await ws.wait_closed()
    finally:
        clients.discard(ws)


async def broadcast(msg: dict):
    if clients:
        payload = json.dumps(msg)
        await asyncio.gather(*(c.send(payload) for c in list(clients)), return_exceptions=True)


def channel_labels(info):
    labels = []
    try:
        ch = info.desc().child("channels").child("channel")
        while ch.name() == "channel":
            labels.append(ch.child_value("label") or f"ch{len(labels) + 1}")
            ch = ch.next_sibling()
    except Exception:
        pass
    n = info.channel_count()
    if len(labels) != n:
        labels = [f"ch{i + 1}" for i in range(n)]
    return labels


async def run_lsl(name, stype):
    from pylsl import StreamInlet, resolve_byprop  # imported late so --simulate works without it

    global meta
    while True:
        await broadcast({"type": "status", "state": "waiting"})
        print(f"Looking for LSL stream (name={name!r}, type={stype!r}) ...")
        prop, value = ("name", name) if name else ("type", stype)
        found = await asyncio.to_thread(resolve_byprop, prop, value, 1, 5.0)
        if not found:
            continue
        inlet = StreamInlet(found[0], max_buflen=5, recover=True)
        info = inlet.info()
        meta = {
            "type": "meta",
            "name": info.name(),
            "srate": info.nominal_srate(),
            "channels": channel_labels(info),
        }
        print(f"Connected: {meta['name']} | {len(meta['channels'])} ch @ {meta['srate']} Hz")
        await broadcast(meta)
        await broadcast({"type": "status", "state": "streaming"})
        try:
            while True:
                samples, stamps = inlet.pull_chunk(timeout=0.0, max_samples=2048)
                if samples:
                    await broadcast({"type": "samples", "t0": stamps[0], "data": samples})
                await asyncio.sleep(1 / BATCH_HZ)
        except Exception as e:  # stream dropped; go back to searching
            print("Stream lost:", e)


async def run_simulated():
    global meta
    srate, n = 250, 8
    meta = {"type": "meta", "name": "SIMULATED", "srate": srate,
            "channels": ["Fp1", "Fp2", "F3", "F4", "C3", "C4", "O1", "O2"][:n]}
    print("SIMULATED data (10 Hz alpha + noise). Not a real EEG signal.")
    await broadcast({"type": "status", "state": "streaming"})
    start, sent = time.time(), 0
    while True:
        due = int((time.time() - start) * srate)
        rows = []
        for i in range(sent, due):
            t = i / srate
            rows.append([20 * math.sin(2 * math.pi * 10 * t + c) for c in range(n)])
        sent = due
        if rows:
            await broadcast({"type": "samples", "t0": start + (due - len(rows)) / srate, "data": rows})
        await asyncio.sleep(1 / BATCH_HZ)


async def main():
    p = argparse.ArgumentParser()
    p.add_argument("--name", help="LSL stream name to connect to")
    p.add_argument("--type", default="EEG", help="LSL stream type (default EEG)")
    p.add_argument("--port", type=int, default=8765)
    p.add_argument("--simulate", action="store_true")
    a = p.parse_args()
    async with websockets.serve(handler, "localhost", a.port):
        print(f"WebSocket bridge on ws://localhost:{a.port}")
        await (run_simulated() if a.simulate else run_lsl(a.name, a.type))


if __name__ == "__main__":
    asyncio.run(main())
