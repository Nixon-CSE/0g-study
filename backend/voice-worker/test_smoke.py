"""
Smoke tests for pipecat-bot.py.

These tests verify:
  1. The bot module is syntactically valid and importable without executing main().
  2. All expected Pipecat class names are importable from their published locations.

The entire test module is skipped when pipecat-ai is not installed so CI
does not fail in environments where the Python venv has not been set up.
"""
import ast
import importlib
import pathlib
import sys
import types

import pytest

# ---------------------------------------------------------------------------
# Skip the whole module if pipecat-ai is absent
# ---------------------------------------------------------------------------
pipecat = pytest.importorskip(
    "pipecat",
    reason="pipecat-ai not installed — run: pip install -r requirements.txt",
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

BOT_PATH = pathlib.Path(__file__).parent / "pipecat-bot.py"

EXPECTED_IMPORTS: list[tuple[str, str]] = [
    ("pipecat.transports.services.daily", "DailyTransport"),
    ("pipecat.transports.services.daily", "DailyParams"),
    ("pipecat.services.deepgram", "DeepgramSTTService"),
    ("pipecat.services.openai", "OpenAILLMService"),
    ("pipecat.services.openai.tts", "OpenAITTSService"),
    ("pipecat.vad.silero", "SileroVADAnalyzer"),
    ("pipecat.pipeline.pipeline", "Pipeline"),
    ("pipecat.pipeline.task", "PipelineTask"),
    ("pipecat.pipeline.task", "PipelineParams"),
    ("pipecat.pipeline.runner", "PipelineRunner"),
    (
        "pipecat.processors.aggregators.openai_llm_context",
        "OpenAILLMContext",
    ),
]


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_bot_parses():
    """pipecat-bot.py must be valid Python syntax."""
    source = BOT_PATH.read_text(encoding="utf-8")
    try:
        ast.parse(source)
    except SyntaxError as exc:
        pytest.fail(f"Syntax error in pipecat-bot.py: {exc}")


def test_bot_importable(monkeypatch):
    """
    pipecat-bot.py must be importable without executing main().

    We load it as a module with __name__ != '__main__' so the
    ``if __name__ == '__main__':`` guard prevents asyncio.run(main()).
    """
    spec = importlib.util.spec_from_file_location("pipecat_bot", BOT_PATH)
    assert spec is not None, "Could not create module spec for pipecat-bot.py"
    mod = importlib.util.module_from_spec(spec)
    # The deferred pipecat imports are inside main(), so top-level import
    # succeeds even without env vars.
    spec.loader.exec_module(mod)  # type: ignore[union-attr]
    assert callable(getattr(mod, "main", None)), "main() not found in pipecat-bot"
    assert callable(getattr(mod, "env", None)), "env() helper not found in pipecat-bot"


@pytest.mark.parametrize("module_path,class_name", EXPECTED_IMPORTS)
def test_pipecat_class_importable(module_path: str, class_name: str):
    """
    Each Pipecat class referenced by the bot must exist at its expected path.

    Catches breaking renames introduced by pipecat-ai version upgrades.
    """
    try:
        mod = importlib.import_module(module_path)
    except ImportError as exc:
        pytest.fail(
            f"Cannot import {module_path}: {exc}. "
            "The pipecat-ai package layout may have changed."
        )
    assert hasattr(mod, class_name), (
        f"{class_name} not found in {module_path}. "
        "Check the pipecat-ai changelog for renames."
    )
