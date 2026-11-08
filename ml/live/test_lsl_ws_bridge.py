import asyncio
import json
import time
import unittest
from unittest.mock import Mock, patch

import websockets
from pylsl import StreamInlet

from ml.live import lsl_ws_bridge as bridge
from ml.live.lsl_ws_bridge import channel_metadata


class BridgeMetadataTests(unittest.TestCase):
    def test_preserves_referential_and_trigger_metadata(self):
        info = Mock()
        info.channel_count.return_value = 3
        info.as_xml.return_value = """<info><desc><channels>
        <channel><label>Fp1</label><type>Referential</type></channel>
        <channel><label>Fp2</label><type>Referential</type></channel>
        <channel><label>Trigger</label><type>TRG</type></channel>
        </channels></desc></info>"""
        self.assertEqual(channel_metadata(info), (["Fp1", "Fp2", "Trigger"], ["Referential", "Referential", "TRG"]))

    def test_mismatch_never_guesses_channel_types(self):
        info = Mock()
        info.channel_count.return_value = 2
        info.as_xml.return_value = "<info><desc><channels><channel><type>EEG</type></channel></channels></desc></info>"
        self.assertEqual(channel_metadata(info), (["ch1", "ch2"], ["", ""]))


class BridgeStreamingTests(unittest.IsolatedAsyncioTestCase):
    async def test_continuous_batches_reach_multiple_clients_and_stall_is_reported(self):
        info = Mock()
        info.name.return_value = "test-live-eeg"
        info.channel_count.return_value = 3
        info.nominal_srate.return_value = 1000
        info.as_xml.return_value = """<info><desc><channels>
        <channel><label>Fp1</label><type>Referential</type></channel>
        <channel><label>Fp2</label><type>Referential</type></channel>
        <channel><label>Trigger</label><type>TRG</type></channel>
        </channels></desc></info>"""
        inlet = Mock(spec=StreamInlet)
        inlet.info.return_value = info
        emitting = True
        tick = 0

        def pull_chunk(**_kwargs):
            nonlocal tick
            tick += 1
            return ([[tick * 0.000001, -tick * 0.000001, 1]], [float(tick)]) if emitting else ([], [])

        inlet.pull_chunk.side_effect = pull_chunk
        discovery = 0

        def resolve(*_args):
            nonlocal discovery
            discovery += 1
            if discovery == 1:
                return [info]
            time.sleep(0.05)
            return []

        with patch("pylsl.resolve_byprop", side_effect=resolve), patch("pylsl.StreamInlet", return_value=inlet), patch.object(bridge, "STREAM_TIMEOUT", 0.2):
            async with websockets.serve(bridge.handler, "127.0.0.1", 0) as server:
                port = server.sockets[0].getsockname()[1]
                worker = asyncio.create_task(bridge.run_lsl("test-live-eeg", "EEG"))
                try:
                    async with websockets.connect(f"ws://127.0.0.1:{port}") as first, websockets.connect(f"ws://127.0.0.1:{port}") as second:
                        async def collect(client):
                            messages = []
                            while sum(item["type"] == "samples" for item in messages) < 3:
                                messages.append(json.loads(await asyncio.wait_for(client.recv(), 3)))
                            return messages

                        first_messages, second_messages = await asyncio.gather(collect(first), collect(second))
                        for messages in (first_messages, second_messages):
                            meta = next(item for item in messages if item["type"] == "meta" and item["name"] == "test-live-eeg")
                            self.assertEqual(meta["channel_types"], ["Referential", "Referential", "TRG"])
                            stamps = [item["t0"] for item in messages if item["type"] == "samples"]
                            self.assertEqual(stamps, sorted(set(stamps)))
                        emitting = False
                        while True:
                            message = json.loads(await asyncio.wait_for(first.recv(), 3))
                            if message.get("state") == "waiting":
                                break
                        inlet.close_stream.assert_called()
                finally:
                    worker.cancel()
                    with self.assertRaises(asyncio.CancelledError):
                        await worker
