# Adapted from mcreader-v2, tts/app/config.py (Adam's rule, 2 October 2026: only speech code is reused).
"""Where everything lives, and the handful of knobs worth changing.

The code sits wherever AI Write is installed and is never written to. What the server downloads and
makes lives under HOME, the speech folder in AI Write's user data (AI Write passes it in
AIWRITE_SPEECH_HOME):

    HOME/venv            the server's own Python environment
    HOME/venvs/breeze    Breeze's environment (its pinned transformers can't share the server's)
    HOME/venvs/sound     the sound effects' environment (Stable Audio Open and CLAP, through diffusers)
    HOME/models          downloaded weights: hf/ (Breeze, Stable Audio Open, CLAP), breeze/code, sound/.ready,
                         parakeet/, whisper/
    HOME/voices          voice clips, and voices/breeze/ for the voices Breeze designs from a description
    HOME/logs            server.log and install.log

The settings at the bottom are read from the environment every time they are asked for, not once at
import: run.py sets them from its flags after this module is already loaded.
"""

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def _home() -> Path:
    given = os.environ.get("AIWRITE_SPEECH_HOME", "").strip()
    # Run by hand without AI Write: a folder in the user's home, never next to the code.
    return Path(given) if given else Path.home() / ".aiwrite-speech"


HOME = _home()
MODELS = HOME / "models"
# Where Breeze's weights are cached (Hugging Face's own cache layout).
HF_HOME = MODELS / "hf"
VENVS = HOME / "venvs"
# A 5-15 second clean speech clip here (.wav/.mp3/.flac) with what it says in a .txt beside it is offered as
# a voice; Breeze copies the voice, not the words. Designed voices are kept in voices/breeze/.
VOICES = HOME / "voices"
LOGS = HOME / "logs"
PARAKEET_DIR = MODELS / "parakeet"
WHISPER_DIR = MODELS / "whisper"

BREEZE_ROOT = HOME
BREEZE_HF_HOME = BREEZE_ROOT / "models" / "hf"
BREEZE_CODE = BREEZE_ROOT / "models" / "breeze" / "code"

WINDOWS = os.name == "nt"

DEFAULT_HOST = "127.0.0.1"
# 8766, so it never clashes with MCreader's or Poor Man's Holodeck's server on 8765.
DEFAULT_PORT = 8766


def venv_python(venv: Path) -> Path:
    """The Python inside a virtual environment, on Windows or anywhere else."""
    return venv / "Scripts" / "python.exe" if WINDOWS else venv / "bin" / "python"


def breeze_python() -> Path:
    return venv_python(BREEZE_ROOT / "venvs" / "breeze")


def sound_python() -> Path:
    return venv_python(VENVS / "sound")


def _env(name: str, fallback: str) -> str:
    value = os.environ.get(name)
    return fallback if value is None or not value.strip() else value.strip()


def host() -> str:
    return _env("AIWRITE_SPEECH_HOST", DEFAULT_HOST)


def port() -> int:
    try:
        return int(_env("AIWRITE_SPEECH_PORT", str(DEFAULT_PORT)))
    except ValueError:
        return DEFAULT_PORT


def device() -> str:
    """"auto" uses the graphics card when torch can see one."""
    value = _env("AIWRITE_SPEECH_DEVICE", "auto").lower()
    return value if value in ("auto", "cpu", "cuda") else "auto"


def preload() -> list[str]:
    """Voice engines loaded at start-up. AI Write starts the server with nothing loaded (Breeze loads on the
    first line read), so the default is none."""
    raw = _env("AIWRITE_SPEECH_PRELOAD", "none").lower()
    if raw == "none":
        return []
    if raw == "all":
        return ["breeze"]
    return [x.strip() for x in raw.split(",") if x.strip()]


def dictation() -> str:
    """The dictation engine Adam picked in AI Write, loaded at start-up: none, parakeet or whisper."""
    raw = _env("AIWRITE_DICTATION", "none").lower()
    return raw if raw in ("none", "parakeet", "whisper") else "none"


def idle_unload_seconds() -> int:
    """Free an unused model after this long. Breeze holds about 8 GB of the graphics card, and a writing
    session goes long stretches without reading; reloading it costs a few seconds."""
    try:
        return int(_env("AIWRITE_SPEECH_IDLE_UNLOAD", "300"))
    except ValueError:
        return 300


def sound_idle_unload_seconds() -> int:
    """Free the sound effects model after this long unused. Sounds are made in batches (a scene's worth at a time), so
    it goes sooner than the voices: its graphics card memory is better given back to them between batches."""
    try:
        return int(_env("AIWRITE_SOUND_IDLE_UNLOAD", "90"))
    except ValueError:
        return 90


def parent_pid() -> int:
    """AI Write's process: the server ends itself if that goes, so it never outlives the app."""
    try:
        return int(_env("AIWRITE_PARENT_PID", "0"))
    except ValueError:
        return 0


def ensure_dirs() -> None:
    for d in (MODELS, VENVS, VOICES, LOGS):
        d.mkdir(parents=True, exist_ok=True)


def child_env(extra: dict | None = None) -> dict:
    """The environment for the processes the server starts: offline, so nothing is fetched while it runs."""
    env = {
        **os.environ,
        "PYTHONUTF8": "1",
        "HF_HUB_OFFLINE": "1",
        "TRANSFORMERS_OFFLINE": "1",
        "HF_HUB_DISABLE_TELEMETRY": "1",
    }
    if extra:
        env.update(extra)
    return env
