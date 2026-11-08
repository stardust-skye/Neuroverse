import contextlib
import io
import unittest
from unittest.mock import Mock, patch

from ml.ant_neuro import test_lsl_connection as diagnostic


def stream(stream_type="EEG"):
    info = Mock()
    info.name.return_value = "test stream"
    info.type.return_value = stream_type
    info.channel_count.return_value = 2
    info.nominal_srate.return_value = 500.0
    info.channel_format.return_value = diagnostic.pylsl.cf_float32
    info.source_id.return_value = "test source"
    info.hostname.return_value = "test host"
    return info


CHANNEL_XML = """<info><desc><channels>
<channel><label>Fp1</label><type>EEG</type><unit>uV</unit></channel>
<channel><label>Status</label><type>Trigger</type><unit>code</unit><index>2</index></channel>
</channels><manufacturer>Example</manufacturer></desc></info>"""


class LSLDiagnosticTests(unittest.TestCase):
    def run_diagnostic(self, streams, inlet=None):
        output = io.StringIO()
        errors = io.StringIO()
        if inlet is not None:
            inlet.info.return_value.as_xml.return_value = CHANNEL_XML
        with (
            patch.object(diagnostic.pylsl, "resolve_streams", return_value=streams) as resolve,
            patch.object(diagnostic.pylsl, "StreamInlet", return_value=inlet) as create_inlet,
            contextlib.redirect_stdout(output),
            contextlib.redirect_stderr(errors),
        ):
            result = diagnostic.main()
        resolve.assert_called_once_with(wait_time=30.0)
        return result, output.getvalue(), errors.getvalue(), create_inlet

    def test_no_stream(self):
        result, output, _, create_inlet = self.run_diagnostic([])
        self.assertEqual(result, 1)
        self.assertIn("No LSL streams found", output)
        create_inlet.assert_not_called()

    def test_non_eeg_stream_metadata_and_no_inlet(self):
        result, output, _, create_inlet = self.run_diagnostic([stream("Markers")])
        self.assertEqual(result, 1)
        for expected in ("test stream", "Markers", "2", "500.0", "float32", "test source", "test host"):
            self.assertIn(expected, output)
        self.assertIn("none has type EEG", output)
        create_inlet.assert_not_called()

    def test_eeg_without_samples(self):
        inlet = Mock()
        inlet.pull_chunk.return_value = ([], [])
        result, output, _, _ = self.run_diagnostic([stream("eeg")], inlet)
        self.assertEqual(result, 1)
        self.assertIn("no samples were received", output)
        self.assertIn("(0, 2)", output)
        inlet.close_stream.assert_called_once()

    def test_actual_sample_dimensions(self):
        inlet = Mock()
        inlet.pull_chunk.return_value = ([[1.0, 2.0], [3.0, 4.0]], [1.0, 2.0])
        result, output, _, _ = self.run_diagnostic([stream()], inlet)
        self.assertEqual(result, 0)
        self.assertIn("sample count: 2", output)
        self.assertIn("(2, 2)", output)
        for expected in ("Fp1", "EEG", "uV", "Status", "Trigger", "code", "index", "Example"):
            self.assertIn(expected, output)
        inlet.close_stream.assert_called_once()

    def test_missing_channel_metadata_and_count_mismatch(self):
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            diagnostic.describe_channels("<info><desc><channels><channel><label>Fp1</label>"
                                         "</channel></channels></desc></info>", 2)
        self.assertIn("does not match", output.getvalue())
        self.assertIn("2:", output.getvalue())
        self.assertIn("(not provided)", output.getvalue())

    def test_exact_stream_selection(self):
        other = stream()
        other.name.return_value = "other"
        desired = stream()
        inlet = Mock()
        inlet.info.return_value.as_xml.return_value = CHANNEL_XML
        inlet.pull_chunk.return_value = ([[1.0, 2.0]], [1.0])
        with (
            patch.object(diagnostic.pylsl, "resolve_streams", return_value=[other, desired]),
            patch.object(diagnostic.pylsl, "StreamInlet", return_value=inlet) as create_inlet,
            contextlib.redirect_stdout(io.StringIO()),
        ):
            result = diagnostic.main("test stream")
        self.assertEqual(result, 0)
        create_inlet.assert_called_once_with(desired, recover=False)

    def test_open_timeout_and_stream_error(self):
        for error, expected in ((diagnostic.LSLTimeoutError("timeout"), 1), (RuntimeError("lost"), 2)):
            with self.subTest(error=error):
                inlet = Mock()
                inlet.open_stream.side_effect = error
                result, _, errors, _ = self.run_diagnostic([stream()], inlet)
                self.assertEqual(result, expected)
                if expected == 2:
                    self.assertIn("lost", errors)
                inlet.close_stream.assert_called_once()

    def test_inconsistent_samples_are_not_reported_as_success(self):
        inlet = Mock()
        inlet.pull_chunk.return_value = ([[1.0]], [1.0])
        result, output, errors, _ = self.run_diagnostic([stream()], inlet)
        self.assertEqual(result, 2)
        self.assertNotIn("Success", output)
        self.assertIn("inconsistent", errors)

    def test_metadata_timeout_still_reports_actual_samples(self):
        inlet = Mock()
        inlet.info.side_effect = diagnostic.LSLTimeoutError("metadata timeout")
        inlet.pull_chunk.return_value = ([[1.0, 2.0]], [1.0])
        result, output, errors, _ = self.run_diagnostic([stream()], inlet)
        self.assertEqual(result, 0)
        self.assertIn("metadata unavailable", errors)
        self.assertIn("sample count: 1", output)
        inlet.close_stream.assert_called_once()

    def test_invalid_metadata_is_not_fabricated(self):
        inlet = Mock()
        inlet.info.return_value.as_xml.return_value = "<invalid"
        inlet.pull_chunk.return_value = ([[1.0, 2.0]], [1.0])
        output = io.StringIO()
        errors = io.StringIO()
        with (
            patch.object(diagnostic.pylsl, "StreamInlet", return_value=inlet),
            contextlib.redirect_stdout(output),
            contextlib.redirect_stderr(errors),
        ):
            result = diagnostic.receive_samples(stream())
        self.assertEqual(result, 0)
        self.assertIn("metadata unavailable", errors.getvalue())
        self.assertIn("sample count: 1", output.getvalue())
        self.assertNotIn("Channel metadata:", output.getvalue())


if __name__ == "__main__":
    unittest.main()
