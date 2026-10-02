# From mcreader-v2, tts/app/engines/base.py (Adam's rule, 2 October 2026: only speech code is reused).
"""The shape every engine has, plus the lazy loading they all want.

Loading a model is slow (Breeze takes a few seconds and about 8 GB of the graphics card) so it happens
on the first request that needs it, never at import. An engine that cannot load reports why instead of
taking the whole server down: dictation must keep working when the voices can't start.
"""

import threading
import time
from typing import Any

import numpy as np


class EngineError(RuntimeError):
    """Something the caller can be told about. The message reaches AI Write."""


#: Every engine the server knows about; filled in by `engines/__init__`. Used to
#: keep only one GPU engine in memory at a time.
REGISTRY: list["Engine"] = []


class Engine:
    id: str = ""
    name: str = ""
    blurb: str = ""
    #: False for engines that cannot be used at all on this machine.
    optional: bool = True
    #: Holds GPU memory while loaded. Loading one unloads the others.
    gpu: bool = False

    def __init__(self) -> None:
        self._model: Any = None
        self._load_lock = threading.Lock()
        self._run_lock = threading.Lock()
        self._load_error: str = ""
        self._load_seconds: float = 0.0
        self._last_used: float = 0.0
        self._requests: int = 0

    # --- subclass hooks -------------------------------------------------

    def _load(self) -> Any:
        raise NotImplementedError

    def _voices(self) -> list[dict]:
        return []

    def _synth(self, model: Any, text: str, voice: str, speed: float, params: dict) -> tuple[np.ndarray, int]:
        raise NotImplementedError

    # --- shared behaviour -----------------------------------------------

    @property
    def loaded(self) -> bool:
        return self._model is not None

    @property
    def last_used(self) -> float:
        """When this engine last synthesized anything; 0 if it never has."""
        return self._last_used

    def load(self) -> Any:
        """Load once; concurrent callers wait for the same load."""
        if self._model is not None:
            return self._model
        with self._load_lock:
            if self._model is not None:
                return self._model
            started = time.time()
            if self.gpu:
                for other in REGISTRY:
                    if other is not self and other.gpu and other.loaded:
                        other.unload()
            try:
                self._model = self._load()
            except Exception as exc:  # noqa: BLE001 - the message is the whole point
                self._load_error = str(exc) or exc.__class__.__name__
                raise EngineError(f"{self.name} could not start: {self._load_error}") from exc
            self._load_error = ""
            self._load_seconds = time.time() - started
            self._loaded_at = time.time()
            # Counts as use, so a model loaded and never spoken with is still let go after a quiet spell.
            self._last_used = time.time()
            return self._model

    def unload(self) -> None:
        with self._load_lock:
            self._model = None
        _free_memory()

    def synth(self, text: str, voice: str, speed: float, params: dict) -> tuple[np.ndarray, int]:
        text = (text or "").strip()
        if not text:
            raise EngineError("Nothing to read.")
        model = self.load()
        # One synthesis at a time: ONNX Runtime and torch both happily saturate
        # every core, and two at once finish later than the same two in a queue.
        with self._run_lock:
            self._last_used = time.time()
            self._requests += 1
            try:
                return self._synth(model, text, voice, speed, params or {})
            except EngineError:
                raise
            except Exception as exc:  # noqa: BLE001
                raise EngineError(f"{self.name} failed on this text: {exc}") from exc

    def voices(self) -> list[dict]:
        """The catalogue. Deliberately does not load the model: asking what voices
        exist must not cost a cold load of the model."""
        try:
            return self._voices()
        except EngineError:
            raise
        except Exception as exc:  # noqa: BLE001
            raise EngineError(f"{self.name} could not list its voices: {exc}") from exc

    def status(self) -> dict:
        """Enough for AI Write to show what is ready, or a reason it isn't."""
        ok, why = self._available()
        detail = self._load_error or why
        count = 0
        if ok:
            try:
                count = len(self._voices())
            except Exception as exc:  # noqa: BLE001 - a broken catalogue is not fatal
                detail = detail or str(exc)
        return {
            "id": self.id,
            "name": self.name,
            "blurb": self.blurb,
            "ready": ok,
            "loaded": self.loaded,
            "detail": detail,
            "voices": count,
            "loadSeconds": round(self._load_seconds, 2) if self.loaded else 0,
            "requests": self._requests,
        }

    def _available(self) -> tuple[bool, str]:
        """Can this engine be used here? `ready` in the status comes from this, not
        from whether the model happens to be in memory."""
        return True, ""


def _free_memory() -> None:
    """Hand freed model memory back to the OS so the idle unload is worth doing."""
    import gc

    gc.collect()
    try:
        import torch

        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    except Exception:  # noqa: BLE001 - torch may not be installed
        pass
