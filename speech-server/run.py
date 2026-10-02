# Adapted from mcreader-v2, tts/run.py (Adam's rule, 2 October 2026: only speech code is reused).
"""Start AI Write's local speech server.

AI Write starts it hidden (Settings, Read aloud and dictation, "Start with AI Write") with its own
environment's Python, and stops it as it quits. By hand, for working on the server itself:

    <speech folder>/venv/Scripts/python run.py --port 8766      (bin/python off Windows)
"""

import argparse
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

# These have to be set before torch, transformers or huggingface_hub are imported,
# which is why this sits above every other import in the file.
from app import config  # noqa: E402

config.ensure_dirs()
os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
# Nothing is fetched while the server runs: models come from the copies downloaded in Settings.
os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
os.environ.setdefault("PYTHONUTF8", "1")


def main() -> int:
    parser = argparse.ArgumentParser(description="Run AI Write's speech server.")
    parser.add_argument("--host", default=config.host())
    parser.add_argument("--port", type=int, default=config.port())
    parser.add_argument("--device", default=config.device(), choices=["auto", "cpu", "cuda"],
                        help="What Breeze runs on.")
    parser.add_argument("--preload", default=None,
                        help="Voice engines to load at start-up: breeze, all, or none.")
    parser.add_argument("--log-level", default=os.environ.get("AIWRITE_SPEECH_LOG", "info"))
    args = parser.parse_args()

    os.environ["AIWRITE_SPEECH_DEVICE"] = args.device
    os.environ["AIWRITE_SPEECH_PORT"] = str(args.port)
    if args.preload is not None:
        os.environ["AIWRITE_SPEECH_PRELOAD"] = args.preload

    # Imported here so the env vars above are in place first.
    import uvicorn

    from app import engines
    from app.server import app

    print()
    print("  AI Write speech server (Breeze TTS 2, Parakeet or Whisper)")
    print(f"  http://{args.host}:{args.port}/v1")
    print(f"  data: {config.HOME}")
    print(f"  voices from: {config.BREEZE_ROOT}")
    print(f"  device: {engines.device_label()}    preload: {', '.join(config.preload()) or 'nothing'}    dictation: {config.dictation()}")
    print(flush=True)

    uvicorn.run(
        app,
        host=args.host,
        port=args.port,
        log_level=args.log_level,
        access_log=False,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
