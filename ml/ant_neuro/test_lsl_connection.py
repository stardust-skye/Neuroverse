"""Discover LSL streams and check for real samples from the first EEG stream.

Run from the project root: venv\\Scripts\\python.exe ml\\ant_neuro\\test_lsl_connection.py
"""

from __future__ import annotations

import argparse
import sys
import time
import xml.etree.ElementTree as ET

try:
    import pylsl
    from pylsl.util import TimeoutError as LSLTimeoutError
except (ImportError, OSError, RuntimeError) as error:
    print(f"Unable to load pylsl or its native library: {error}", file=sys.stderr)
    raise SystemExit(2) from error


DISCOVERY_SECONDS = 30.0
RECEPTION_SECONDS = 10.0
METADATA_SECONDS = 5.0
CHANNEL_FORMATS = {
    pylsl.cf_undefined: "undefined",
    pylsl.cf_float32: "float32",
    pylsl.cf_double64: "double64",
    pylsl.cf_string: "string",
    pylsl.cf_int32: "int32",
    pylsl.cf_int16: "int16",
    pylsl.cf_int8: "int8",
    pylsl.cf_int64: "int64",
}


def describe_stream(stream: pylsl.StreamInfo, number: int) -> None:
    channel_format = stream.channel_format()
    format_name = CHANNEL_FORMATS.get(channel_format, f"unknown ({channel_format})")
    print(f"\nStream {number}:")
    print(f"  Name: {stream.name() or '(not provided)'}")
    print(f"  Type: {stream.type() or '(not provided)'}")
    print(f"  Channel count: {stream.channel_count()}")
    print(f"  Sampling rate: {stream.nominal_srate()} Hz (0 means irregular)")
    print(f"  Channel format: {format_name}")
    print(f"  Source ID: {stream.source_id() or '(not provided)'}")
    print(f"  Hostname: {stream.hostname() or '(not available)'}")


def describe_channels(xml: str, expected_count: int) -> None:
    root = ET.fromstring(xml)
    channels = root.findall("./desc/channels/channel")
    print(f"\nChannel metadata: {len(channels)} entries for {expected_count} stream channels")
    if len(channels) != expected_count:
        print("WARNING: Channel metadata count does not match the stream channel count.")
    for index in range(max(expected_count, len(channels))):
        channel = channels[index] if index < len(channels) else None
        fields = {}
        if channel is not None:
            for child in channel:
                value = "".join(child.itertext()).strip()
                fields.setdefault(child.tag, []).append(value or "(not provided)")
        print(f"  {index + 1}:")
        for field in ("label", "type", "unit"):
            print(f"    {field}: {', '.join(fields.pop(field, [])) or '(not provided)'}")
        for field, values in fields.items():
            print(f"    {field}: {', '.join(values)}")
    description = root.find("./desc")
    if description is not None:
        for child in description:
            if child.tag != "channels":
                print(f"  Other description metadata: {ET.tostring(child, encoding='unicode').strip()}")
    print("Channel roles are reported as supplied; unlabeled channels cannot be classified safely.")


def receive_samples(stream: pylsl.StreamInfo) -> int:
    print(f"\nTesting EEG stream: {stream.name() or '(unnamed)'}")
    print(f"Waiting up to {RECEPTION_SECONDS:g} seconds for samples...")
    inlet = None
    deadline = time.monotonic() + RECEPTION_SECONDS
    try:
        inlet = pylsl.StreamInlet(stream, recover=False)
        inlet.open_stream(timeout=max(0.0, deadline - time.monotonic()))
        try:
            full_info = inlet.info(timeout=min(METADATA_SECONDS, max(0.0, deadline - time.monotonic())))
            describe_channels(full_info.as_xml(), stream.channel_count())
        except (LSLTimeoutError, ET.ParseError) as error:
            print(f"Channel metadata unavailable: {error}", file=sys.stderr)
        remaining = max(0.0, deadline - time.monotonic())
        samples, timestamps = inlet.pull_chunk(timeout=remaining, max_samples=1024)
        if not samples:
            print("EEG stream found, but no samples were received within the time limit.")
            print(f"Received sample count: 0; array dimensions: (0, {stream.channel_count()})")
            return 1
        if len(samples) != len(timestamps) or any(
            len(sample) != stream.channel_count() for sample in samples
        ):
            print("Error: received inconsistent sample or timestamp dimensions.", file=sys.stderr)
            return 2
        print("Success: actual EEG stream samples received.")
        print(
            f"Received sample count: {len(samples)}; "
            f"array dimensions: ({len(samples)}, {stream.channel_count()}) "
            "(samples, channels)"
        )
        return 0
    except LSLTimeoutError:
        print("EEG stream found, but no samples were received within the time limit.")
        print(f"Received sample count: 0; array dimensions: (0, {stream.channel_count()})")
        return 1
    except (RuntimeError, OSError) as error:
        print(f"Error receiving EEG stream samples: {error}", file=sys.stderr)
        return 2
    finally:
        if inlet is not None:
            inlet.close_stream()


def main(stream_name: str | None = None) -> int:
    print(f"Discovering LSL streams for up to {DISCOVERY_SECONDS:g} seconds...")
    try:
        streams = pylsl.resolve_streams(wait_time=DISCOVERY_SECONDS)
        if not streams:
            print("No LSL streams found.")
            return 1
        for number, stream in enumerate(streams, start=1):
            describe_stream(stream, number)
        eeg_streams = [stream for stream in streams if stream.type().strip().casefold() == "eeg"]
        if stream_name is not None:
            eeg_streams = [stream for stream in eeg_streams if stream.name() == stream_name]
            if not eeg_streams:
                print(f"\nNo EEG stream found with the exact name {stream_name!r}.")
                return 1
        if not eeg_streams:
            print("\nStreams found, but none has type EEG.")
            return 1
        if len(eeg_streams) > 1:
            print(f"\nFound {len(eeg_streams)} EEG streams; testing the first discovered.")
        return receive_samples(eeg_streams[0])
    except (RuntimeError, OSError) as error:
        print(f"Error discovering or inspecting LSL streams: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    try:
        parser = argparse.ArgumentParser(description=__doc__)
        parser.add_argument("--stream-name", help="Select an EEG stream by its exact name.")
        args = parser.parse_args()
        raise SystemExit(main(args.stream_name))
    except KeyboardInterrupt:
        print("\nLSL connection test interrupted.", file=sys.stderr)
        raise SystemExit(130)
