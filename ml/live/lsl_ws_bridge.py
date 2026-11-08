"""Bridge a live LSL EEG stream (e.g. from the ANT Neuro eego software) to browsers.

Usage (from the Neuroverse project root, venv active):
    python -m ml.live.lsl_ws_bridge                 # first LSL stream of type EEG
    python -m ml.live.lsl_ws_bridge --name "eego"   # pick a stream by name
    python -m ml.live.lsl_ws_bridge --simulate      # fake 8-ch data, no headset needed

Browser connects to ws://localhost:8765 and receives JSON:
    {"type": "meta", "name", "srate", "channels": [...labels], "channel_types": [...]}
    {"type": "samples", "t0": <lsl time of first sample>, "data": [[ch1..chN], ...]}
    {"type": "status", "state": "waiting" | "streaming"}
"""
import argparse
import asyncio
import json
import math
import time
import xml.etree.ElementTree as ET

import websockets

BATCH_HZ = 30  # how often we push batches to the browser
STREAM_TIMEOUT = 3.0

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
        results = await asyncio.gather(*(c.send(payload) for c in list(clients)), return_exceptions=True)
        for result in results:
            if isinstance(result, Exception):
                print(f"WebSocket client send failed: {result}", flush=True)


def channel_metadata(info):
    channels = ET.fromstring(info.as_xml()).findall("./desc/channels/channel")
    count = info.channel_count()
    if len(channels) != count:
        print(f"Channel metadata count {len(channels)} does not match {count}; channel types are unknown.", flush=True)
        return [f"ch{i + 1}" for i in range(count)], [""] * count
    labels = [(channel.findtext("label") or "").strip() or f"ch{i + 1}" for i, channel in enumerate(channels)]
    types = [(channel.findtext("type") or "").strip() for channel in channels]
    return labels, types


async def run_lsl(name, stype):
    from pylsl import StreamInlet, resolve_byprop  # imported late so --simulate works without it

    global meta
    while True:
        meta = {"type": "meta", "name": "none", "srate": 0, "channels": []}
        await broadcast({"type": "status", "state": "waiting"})
        print(f"Looking for LSL stream (name={name!r}, type={stype!r}) ...")
        prop, value = ("name", name) if name else ("type", stype)
        found = await asyncio.to_thread(resolve_byprop, prop, value, 1, 5.0)
        if not found:
            continue
        inlet = None
        try:
            inlet = StreamInlet(found[0], max_buflen=5, recover=False)
            info = await asyncio.to_thread(inlet.info, 5.0)
            labels, types = channel_metadata(info)
            meta = {
                "type": "meta",
                "name": info.name(),
                "srate": info.nominal_srate(),
                "channels": labels,
                "channel_types": types,
            }
            print(f"Connected: {meta['name']} | {len(labels)} ch @ {meta['srate']} Hz", flush=True)
            await broadcast(meta)
            await broadcast({"type": "status", "state": "streaming"})
            last_sample = time.monotonic()
            while True:
                samples, stamps = inlet.pull_chunk(timeout=0.0, max_samples=2048)
                if samples:
                    last_sample = time.monotonic()
                    await broadcast({"type": "samples", "t0": stamps[0], "data": samples})
                elif time.monotonic() - last_sample > STREAM_TIMEOUT:
                    print("EEG samples stopped; looking for the stream again.", flush=True)
                    break
                await asyncio.sleep(1 / BATCH_HZ)
        except (RuntimeError, OSError, ET.ParseError) as error:
            print(f"EEG stream error: {error}", flush=True)
        finally:
            if inlet is not None:
                inlet.close_stream()


async def run_simulated():
    global meta
    srate, n = 250, 8
    meta = {"type": "meta", "name": "SIMULATED", "srate": srate,
            "channels": ["Fp1", "Fp2", "F3", "F4", "C3", "C4", "O1", "O2"][:n],
            "channel_types": ["EEG"] * n}
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
