# Adapted from mcreader-v2, tts/app/engines/__init__.py (Adam's rule, 2 October 2026: only speech code is reused).
"""The voice engines this server knows about: Breeze TTS 2 only (dictation is in app/stt.py).

AI Write's addition: the sound effects (Stable Audio Open, `sound()`), which share the graphics card with the
voices but are not a voice: they are kept out of every list of engines and voices here.
"""

import threading
import time

from .. import config
from .base import Engine, EngineBusy, EngineError
from . import base, gpu
from .breeze_engine import BreezeEngine
from .sound_engine import SoundEngine

DEFAULT_ENGINE = "breeze"

_ORDER: tuple[type[Engine], ...] = (BreezeEngine,)
_ENGINES: dict[str, Engine] = {cls.id: cls() for cls in _ORDER}
base.REGISTRY.extend(_ENGINES.values())
# Registered for sharing the graphics card, never listed as a voice engine.
_SOUND = SoundEngine()
base.REGISTRY.append(_SOUND)


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


def sound() -> SoundEngine:
    """The sound effects engine."""
    return _SOUND


def every_engine() -> list[Engine]:
    """The voice engines and the sound effects: everything that holds a model, for letting go of them all."""
    return [*all_engines(), _SOUND]


def sounds_beside() -> bool:
    """The voices and the sound effects can both be held on the graphics card now, each at its most: what is free
    covers what each still needs (all of it when not loaded, how much it grows as it works when loaded). False when
    that can't be told (no NVIDIA card, or nvidia-smi failed). On a 16 GB card beside the desktop it is False."""
    free = gpu.free_mb()
    if free is None:
        return False
    voices = _ENGINES[DEFAULT_ENGINE]
    return free >= voices.grows_mb() + _SOUND.grows_mb() + gpu.MARGIN_MB


def sounds_status() -> dict:
    """What /v1/health says about the sound effects."""
    return _SOUND.sound_status(sounds_beside())


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
    go hours without reading aloud. The sound effects have a shorter limit of their own.
    """
    while True:
        time.sleep(15)
        now = time.time()
        for engine in every_engine():
            limit = config.sound_idle_unload_seconds() if engine is _SOUND else config.idle_unload_seconds()
            if limit <= 0 or engine.busy:
                continue
            if engine.loaded and engine.last_used and now - engine.last_used > limit:
                engine.unload()


def start_idle_watch() -> None:
    if config.idle_unload_seconds() <= 0 and config.sound_idle_unload_seconds() <= 0:
        return
    threading.Thread(target=_idle_watch, name="idle-unload", daemon=True).start()


_card: list[str] = []


def _nvidia_card() -> str:
    """The NVIDIA graphics card's name from nvidia-smi (which comes with its driver), asked once; "" when there is none."""
    if not _card:
        _card.append(gpu.ask("name"))
    return _card[0]


def device_label() -> str:
    """What the voices run on, as MCreader's server says it: "CUDA · <card>" or "CPU"."""
    for engine in all_engines():
        named = getattr(engine, "device_name", "")
        if named and named.lower() not in ("cpu", "?"):
            return f"CUDA · {named}"
    card = _nvidia_card()
    return f"CUDA · {card}" if card else "CPU"


__all__ = [
    "Engine", "EngineError", "EngineBusy", "DEFAULT_ENGINE",
    "get", "all_engines", "default_engine", "statuses", "voices",
    "sound", "every_engine", "sounds_beside", "sounds_status",
    "warmup", "start_idle_watch", "device_label",
]
