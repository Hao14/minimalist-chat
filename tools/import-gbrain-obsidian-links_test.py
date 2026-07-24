from __future__ import annotations

import argparse
import importlib.util
import subprocess
import unittest
from pathlib import Path
from unittest.mock import patch


MODULE_PATH = Path(__file__).with_name("import-gbrain-obsidian-links.py")
SPEC = importlib.util.spec_from_file_location("gbrain_obsidian_links", MODULE_PATH)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class ObsidianLinkCommandTests(unittest.TestCase):
    def test_timeout_is_bounded(self) -> None:
        self.assertEqual(MODULE.bounded_timeout("120"), 120)
        for value in ("4", "601", "not-a-number"):
            with self.assertRaises(argparse.ArgumentTypeError):
                MODULE.bounded_timeout(value)

    @patch.object(MODULE.subprocess, "run")
    def test_informative_timeout_is_a_recoverable_failure(self, run) -> None:
        run.side_effect = subprocess.TimeoutExpired(
            cmd=["gbrain", "link"],
            timeout=120,
            stderr="watchdog still working",
        )
        failure = MODULE.run_gbrain_command(
            Path("gbrain"), ["link", "from", "to"], "add from -> to", 120
        )
        self.assertIn("timed out after 120 seconds", failure)
        self.assertIn("watchdog still working", failure)

    @patch.object(MODULE.subprocess, "run")
    def test_zero_exit_succeeds_and_nonzero_fails_closed(self, run) -> None:
        run.return_value = subprocess.CompletedProcess([], 0, stdout="ok", stderr="")
        self.assertIsNone(
            MODULE.run_gbrain_command(Path("gbrain"), ["link"], "add", 120)
        )
        run.return_value = subprocess.CompletedProcess([], 9, stdout="", stderr="real failure")
        self.assertEqual(
            MODULE.run_gbrain_command(Path("gbrain"), ["link"], "add", 120),
            "add: real failure",
        )


if __name__ == "__main__":
    unittest.main()
