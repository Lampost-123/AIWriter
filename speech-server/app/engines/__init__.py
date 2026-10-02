# Adapted from mcreader-v2, tts/app/engines/__init__.py (Adam's rule, 2 October 2026: only speech code is reused).
"""The voice engines this server knows about: Breeze TTS 2 only (dictation is in app/stt.py)."""

import os
import shutil
import subprocess
import threading
import time
from pathlib import Path

from .. import config
from .base import Engine, EngineError
from . import base
from .breeze_engine import BreezeEngine

DEFAULT_ENGINE = "breeze"

_ORDER: tuple[type[Engine], ...] = (BreezeEngine,)
_ENGINES: dict[str, Engine] = {cls.id: cls() for cls in _ORDER}
base.REGISTRY.extend(_ENGINES.values())


def get(engine_id: str | None) -> Engine:
    name = (engine_id or DEFAULT_ENGINE).strip().lower()
    # The OpenAI `model` field lands here too, so accept the friendly spellings a model list might use.
    name = {"breeze-tts": "breeze", "breeze-tts-2": "breeze"}.get(name, name)
    engine = _ENGINES.get(name)
    if engine is None:
        raise EngineError(
            f"Unknown engine “{engine_id}”. Try one of: {', '.join(_ENGINES)}."
        )
    return engine


def all_engines() -> list[Engine]:
    return [_ENGINES[cls.id] for cls in _ORDER]


def default_engine() -> Engine:
    """The best engine that actually works here."""
    for engine in all_engines():
        if engine.status()["ready"]:
            return engine
    return _ENGINES[DEFAULT_ENGINE]


def statuses() -> list[dict]:
    return [e.status() for e in all_engines()]


def voices(engine_id: str | None = None) -> list[dict]:
    if engine_id:
        return get(engine_id).voices()
    out: list[dict] = []
    for engine in all_engines():
        try:
            out.extend(engine.voices())
        except EngineError:
            continue
    return out


def warmup(only: list[str] | None = None) -> dict:
    """Load engines now so the first sentence is not the one that waits.

    Each engine is made to speak one short line as well. Loading the weights is
    only part of the cost: the first real request also pays for the CUDA kernels
    and the allocator, and that request would otherwise be the first paragraph
    Adam asked to hear.
    """
    names = only if only is not None else config.preload()
    result: dict[str, str] = {}
    for name in names:
        try:
            engine = get(name)
        except EngineError as exc:
            result[name] = str(exc)
            continue
        try:
            engine.load()
            # A sentence rather than a single word: a real sentence exercises the
            # same path the first paragraph will.
            engine.synth("Ready when you are.", "", 1.0, {})
        except EngineError as exc:
            result[engine.id] = str(exc)
            continue
        result[engine.id] = "ready"
    return result


def _idle_watch() -> None:
    """Free a model that has not been asked for anything in a while.

    Breeze holds gigabytes of the graphics card while loaded, and a writing session can
    go hours without reading aloud.
    """
    while True:
        time.sleep(30)
        limit = config.idle_unload_seconds()
        now = time.time()
        for engine in all_engines():
            if engine.loaded and engine.last_used and now - engine.last_used > limit:
                engine.unload()


def start_idle_watch() -> None:
    if config.idle_unload_seconds() <= 0:
        return
    threading.Thread(target=_idle_watch, name="idle-unload", daemon=True).start()


_card: list[str] = []


def _nvidia_card() -> str:
    """The NVIDIA graphics card's name from nvidia-smi (which comes with its driver), asked once; "" when there is none."""
    if _card:
        return _card[0]
    name = ""
    found = shutil.which("nvidia-smi")
    if not found and config.WINDOWS:
        program_files = os.environ.get("ProgramFiles", r"C:\Program Files")
        older = Path(program_files) / "NVIDIA Corporation" / "NVSMI" / "nvidia-smi.exe"
        found = str(older) if older.is_file() else None
    if found:
        try:
            out = subprocess.run(
                [found, "--query-gpu=name", "--format=csv,noheader"],
                capture_output=True, text=True, timeout=10,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
            if out.returncode == 0:
                name = next((line.strip() for line in out.stdout.splitlines() if line.strip()), "")
        except (OSError, subprocess.SubprocessError):
            name = ""
    _card.append(name)
    return name


def device_label() -> str:
    """What the voices run on, as MCreader's server says it: "CUDA · <card>" or "CPU"."""
    for engine in all_engines():
        named = getattr(engine, "device_name", "")
        if named and named.lower() not in ("cpu", "?"):
            return f"CUDA · {named}"
    card = _nvidia_card()
    return f"CUDA · {card}" if card else "CPU"


__all__ = [
    "Engine", "EngineError", "DEFAULT_ENGINE",
    "get", "all_engines", "default_engine", "statuses", "voices",
    "warmup", "start_idle_watch", "device_label",
]
