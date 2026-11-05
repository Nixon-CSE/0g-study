#!/usr/bin/env python3
"""
BonFire Pipecat voice bot.

Spawned by backend/src/voice/worker-spawn.ts as a subprocess, one per active
Daily voice room.  All configuration is passed via environment variables.

Exit codes:
  0  clean shutdown (SIGTERM, room empty)
  2  missing required env var
  1  unhandled exception
"""
import asyncio
import os
import signal
import sys
import logging

logging.basicConfig(
    level=logging.INFO,
    stream=sys.stderr,
    format="[bot] %(message)s",
)
log = logging.getLogger("bot")


def env(name: str, default=None) -> str:
    v = os.environ.get(name, default)
    if v is None:
        log.error("missing required env: %s", name)
        sys.exit(2)
    return v


async def main() -> None:
    room_url    = env("DAILY_ROOM_URL")
    bot_token   = env("DAILY_BOT_TOKEN")
    dg_api_key  = env("DEEPGRAM_API_KEY")
    openai_key  = env("OPENAI_API_KEY")
    og_base_url = env("OG_LLM_BASE_URL")
    og_api_key  = env("OG_LLM_API_KEY")
    og_model    = os.environ.get("OG_LLM_MODEL") or "auto"  # the backend proxy pins the provider's real model

    agent_soul = (
        os.environ.get("AGENT_SOUL", "").strip()
        or "You are a helpful voice assistant. Keep replies concise and friendly."
    )
    agent_rules = os.environ.get("AGENT_AGENTS", "").strip()  # operating rules from AGENTS.md
    agent_name = os.environ.get("AGENT_NAME", "Ember")
    agent_slug = os.environ.get("AGENT_SLUG", "")

    # Compose the system prompt the same shape ember-agent's prompt-builder uses:
    #   <soul>…</soul>
    #   <operating_rules>…</operating_rules>
    #   + a one-liner reminder this is voice (keep replies short for TTS).
    system_prompt_parts = [
        f"<soul>\n{agent_soul}\n</soul>",
    ]
    if agent_rules:
        system_prompt_parts.append(f"<operating_rules>\n{agent_rules}\n</operating_rules>")
    system_prompt_parts.append(
        "[Voice context] You are in a live voice conversation. Keep replies SHORT (1-3 sentences). "
        "No markdown, no code blocks — your words will be spoken aloud."
    )
    system_prompt = "\n\n".join(system_prompt_parts)
    tts_voice = os.environ.get("OPENAI_TTS_VOICE", "nova")
    tts_model = os.environ.get("OPENAI_TTS_MODEL", "tts-1")

    log.info("joining room=%s agent=%s slug=%s", room_url, agent_name, agent_slug)

    # Pipecat 1.x import paths
    from pipecat.transports.daily.transport import DailyTransport, DailyParams
    from pipecat.services.deepgram.stt import DeepgramSTTService
    from pipecat.services.openai.llm import OpenAILLMService
    from pipecat.services.openai.tts import OpenAITTSService
    from pipecat.audio.vad.silero import SileroVADAnalyzer
    from pipecat.pipeline.pipeline import Pipeline
    from pipecat.pipeline.task import PipelineTask, PipelineParams
    from pipecat.pipeline.runner import PipelineRunner
    from pipecat.processors.aggregators.llm_context import LLMContext
    from pipecat.processors.aggregators.llm_response_universal import (
        LLMContextAggregatorPair,
    )

    transport = DailyTransport(
        room_url,
        bot_token,
        agent_name,
        DailyParams(
            audio_in_enabled=True,
            audio_out_enabled=True,
            # Audio-only — never publish or subscribe to video.
            camera_in_enabled=False,
            camera_out_enabled=False,
            transcription_enabled=False,
            vad_analyzer=SileroVADAnalyzer(),
        ),
    )

    stt = DeepgramSTTService(api_key=dg_api_key)

    llm = OpenAILLMService(
        api_key=og_api_key,
        model=og_model,
        base_url=og_base_url,
    )

    tts = OpenAITTSService(
        api_key=openai_key,
        model=tts_model,
        voice=tts_voice,
    )

    # System prompt + initial assistant greeting
    greeting = f"Hi, I'm {agent_name}. Let's talk!"
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "assistant", "content": greeting},
    ]
    context = LLMContext(messages=messages)
    context_aggregator = LLMContextAggregatorPair(context)

    pipeline = Pipeline(
        [
            transport.input(),
            stt,
            context_aggregator.user(),
            llm,
            tts,
            transport.output(),
            context_aggregator.assistant(),
        ]
    )

    task = PipelineTask(
        pipeline,
        params=PipelineParams(allow_interruptions=True),
    )

    @transport.event_handler("on_first_participant_joined")
    async def _on_first(transport, participant):  # noqa: ARG001
        log.info("first participant joined id=%s", participant.get("id", "?"))

    @transport.event_handler("on_participant_left")
    async def _on_left(transport, participant, reason):  # noqa: ARG001
        log.info("participant left id=%s reason=%s", participant.get("id", "?"), reason)
        # The bot itself is also a participant. Leave when only we remain.
        try:
            remaining = transport.participants()
        except Exception:
            remaining = {}
        if len(remaining) <= 1:
            log.info("room empty — cancelling pipeline")
            await task.cancel()

    @transport.event_handler("on_call_state_updated")
    async def _on_call_state(transport, state):  # noqa: ARG001
        log.info("call state=%s", state)
        if state == "left":
            await task.cancel()

    # SIGTERM → graceful shutdown
    loop = asyncio.get_event_loop()

    def _sigterm(*_):
        log.info("SIGTERM — cancelling pipeline")
        loop.call_soon_threadsafe(lambda: asyncio.ensure_future(task.cancel()))

    signal.signal(signal.SIGTERM, _sigterm)

    runner = PipelineRunner()
    log.info("pipeline running")
    await runner.run(task)
    log.info("leaving room=%s", room_url)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        log.info("interrupted")
        sys.exit(0)
    except Exception as exc:
        log.exception("unhandled: %s", exc)
        sys.exit(1)
