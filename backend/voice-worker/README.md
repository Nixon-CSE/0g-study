# BonFire Voice Worker

Pipecat-powered voice bot, spawned by the BonFire backend as one Python
subprocess per active Daily voice room.  See
`backend/src/voice/worker-spawn.ts` for how the parent process manages
the subprocess (env injection, stdout/stderr piping, SIGTERM on teardown).

## Pipeline

```
DailyTransport input
  → SileroVAD
  → DeepgramSTTService
  → OpenAILLMService  (0G Compute, via the backend's /internal/og-llm proxy)
  → OpenAITTSService
  → DailyTransport output
```

## Setup

Requires Python 3.10+.

```bash
python3.10 -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

## Running manually (for local dev)

```bash
export DAILY_ROOM_URL=https://your-domain.daily.co/room-name
export DAILY_BOT_TOKEN=<meeting-token>
export DEEPGRAM_API_KEY=...
export OPENAI_API_KEY=...          # OpenAI TTS
export OG_LLM_BASE_URL=https://...
export OG_LLM_API_KEY=...
export OG_LLM_MODEL=...
export AGENT_NAME="Ember"
export AGENT_SOUL="You are a helpful voice assistant."
python pipecat-bot.py
```

Optional overrides: `OPENAI_TTS_VOICE` (default `nova`), `OPENAI_TTS_MODEL` (default `tts-1`),
`AGENT_SLUG`, `OG_LLM_MODEL` (default `auto` — the backend proxy always asks the 0G Compute provider for the model it serves).

## Tests

```bash
pip install pytest
pytest test_smoke.py -v
```

Tests are skipped automatically when `pipecat-ai` is not installed.
