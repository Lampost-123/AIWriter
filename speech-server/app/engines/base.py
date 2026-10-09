# From mcreader-v2, tts/app/engines/base.py (Adam's rule, 2 October 2026: only speech code is reused).
"""The shape every engine has, plus the lazy loading they all want.

Loading a model is slow (Breeze takes a few seconds and about 9.5 GB of the graphics card) so it happens
on the first request that needs it, never at import. An engine that cannot load reports why instead of
taking the whole server down: dictation must keep working when the voices can't start.

AI Write's change: the graphics card is shared. A GPU engine loads beside the others when nvidia-smi says
there is room for it (`needs_mb`), and otherwise lets them go first, as before, except that it never pushes
out an engine with a higher `priority` that is in use: the sound effects wait for the voices, never the
other way round. Nor do the voices wait for the sound effects to finish starting: a lower-priority start under
way is stopped (it is tried again later). Without nvidia-smi's answer every other GPU engine is let go, as before.
"""

import threading
import time
from typing import Any

import numpy as np

from . import gpu


class EngineError(RuntimeError):
    """Something the caller can be told about. The message reaches AI Write."""


class EngineBusy(EngineError):
    """It can't run now, but will soon: another engine has the graphics card, or took it back part way. Try again later."""


#: Every engine the server knows about; filled in by `engines/__init__`. Used to
#: share the graphics card between the GPU engines.
REGISTRY: list["Engine"] = []

# GPU engines load one at a time, so two never make room for themselves at once (or wait on each other's locks).
_GPU_LOCK = threading.Lock()
# The priorities of the GPU engines waiting to load now. A lower-priority engine gives way to them: it doesn't start
# loading, and one starting is stopped (WorkerEngine). Changed and read with _WANT_LOCK held.
_WANT_LOCK = threading.Lock()
_wanting: list[int] = []
# An engine that finished working this recently counts as in use: one with a lower priority waits rather than push it
# out. Generous, since the voices take over a minute to load again, and a reading pauses between paragraphs and pages.
IN_USE_SECONDS = 180


class Engine:
    id: str = ""
    name: str = ""
    blurb: str = ""
    #: False for engines that cannot be used at all on this machine.
    optional: bool = True
    #: Holds GPU memory while loaded. Loading one unloads the others when they don't fit together.
    gpu: bool = False
    #: The most of the graphics card it holds while working, in MiB (0: unknown, so the others always go).
    needs_mb: int = 0
    #: What it holds while loaded and resting (0: as much as `needs_mb`). The difference is how much it can still grow.
    holds_mb: int = 0
    #: An engine never pushes out one with a higher priority that is in use (the voices are 1, the sound effects 0).
    priority: int = 0
    #: Why an engine with a lower priority has to wait for this one (after its name).
    wait_reason = "is using the graphics card now. Try again once it has finished."

    def __init__(self) -> None:
        self._model: Any = None
        self._load_lock = threading.Lock()
        self._run_lock = threading.Lock()
        self._load_error: str = ""
        self._load_seconds: float = 0.0
        self._last_used: float = 0.0
        self._requests: int = 0
        # Requests that have asked for the model and not finished yet (some still loading or waiting their turn).
        self._wanted = 0
        self._wanted_lock = threading.Lock()

    # --- subclass hooks -------------------------------------------------

    def _load(self) -> Any:
        raise NotImplementedError

    def _voices(self) -> list[dict]:
        return []

    def _synth(self, model: Any, text: str, voice: str, speed: float, params: dict) -> tuple[np.ndarray, int]:
        raise NotImplementedError

    def _abort_start(self) -> None:
        """Stops a load under way, if it can (WorkerEngine stops its starting worker): a higher-priority engine wants the
        graphics card. That load then fails with EngineBusy."""

    # --- shared behaviour -----------------------------------------------

    @property
    def loaded(self) -> bool:
        return self._model is not None

    @property
    def last_used(self) -> float:
        """When this engine last synthesized anything; 0 if it never has."""
        return self._last_used

    @property
    def busy(self) -> bool:
        """Working on a request now."""
        return self._run_lock.locked()

    @property
    def wanted(self) -> bool:
        """A request has asked for the model and hasn't finished (it may still be loading it, or waiting its turn)."""
        return self._wanted > 0

    def in_use(self) -> bool:
        """Working now, about to, or finished recently enough that it will likely be asked again soon."""
        return self.busy or self.wanted or (self._last_used > 0 and time.time() - self._last_used < IN_USE_SECONDS)

    def want(self) -> "_Wanted":
        """`with engine.want():` around a request, from before it loads the model to after it is done."""
        return _Wanted(self)

    def grows_mb(self) -> int:
        """How much more of the graphics card it can take than it holds now: all it needs when not loaded."""
        if not self.loaded:
            return self.needs_mb
        return max(0, self.needs_mb - (self.holds_mb or self.needs_mb))

    def gives_way(self) -> bool:
        """A GPU engine with a higher priority is waiting to load. Call with _WANT_LOCK held."""
        return any(p > self.priority for p in _wanting)

    def load(self) -> Any:
        """Load once; concurrent callers wait for the same load."""
        if self._model is not None:
            return self._model
        if not self.gpu:
            return self._load_now()
        with _WANT_LOCK:
            _wanting.append(self.priority)
            # Never wait for a lower-priority engine to finish starting: its start is stopped, and tried again later.
            for other in REGISTRY:
                if other is not self and other.gpu and other.priority < self.priority:
                    other._abort_start()
        waiting = True
        try:
            with _GPU_LOCK:
                with _WANT_LOCK:
                    _wanting.remove(self.priority)
                    waiting = False
                    giving_way = self.gives_way()
                if giving_way and self._model is None:
                    raise EngineBusy(GIVE_WAY)
                return self._load_now()
        finally:
            if waiting:
                with _WANT_LOCK:
                    _wanting.remove(self.priority)

    def _load_now(self) -> Any:
        with self._load_lock:
            if self._model is not None:
                return self._model
            started = time.time()
            if self.gpu:
                self._make_room()
            try:
                self._model = self._load()
            except EngineBusy:
                # Stopped to make way for a higher-priority engine: nothing is wrong with it.
                raise
            except Exception as exc:  # noqa: BLE001 - the message is the whole point
                self._load_error = str(exc) or exc.__class__.__name__
                raise EngineError(f"{self.name} could not start: {self._load_error}") from exc
            finally:
                gpu.forget()
            self._load_error = ""
            self._load_seconds = time.time() - started
            self._loaded_at = time.time()
            # Counts as use, so a model loaded and never spoken with is still let go after a quiet spell.
            self._last_used = time.time()
            return self._model

    def _make_room(self) -> None:
        """Lets go of the other GPU engines when this one won't fit beside them. Called with _GPU_LOCK held.

        A higher-priority engine is let go only while it is idle: its run lock is taken (without waiting) and held
        while it goes, so it can't start a request meanwhile, and one that is wanted or was used recently stays."""
        others = [o for o in REGISTRY if o is not self and o.gpu and o.loaded]
        if not others:
            return
        known = self.needs_mb > 0 and all(o.needs_mb > 0 for o in others)
        free = gpu.free_mb(fresh=True) if known else None
        # Room for this one at its most, and for the others to grow to theirs as they work.
        if free is not None and free >= self.needs_mb + sum(o.grows_mb() for o in others) + gpu.MARGIN_MB:
            return
        held: list[Engine] = []
        try:
            for other in others:
                if other.priority <= self.priority:
                    continue
                if not other._run_lock.acquire(blocking=False):
                    raise EngineBusy(f"{other.name} {other.wait_reason}")
                held.append(other)
                if other.wanted or (other._last_used > 0 and time.time() - other._last_used < IN_USE_SECONDS):
                    raise EngineBusy(f"{other.name} {other.wait_reason}")
            for other in others:
                other.unload()
        finally:
            for other in held:
                other._run_lock.release()

    def unload(self) -> None:
        with self._load_lock:
            self._model = None
        _free_memory()
        gpu.forget()

    def synth(self, text: str, voice: str, speed: float, params: dict) -> tuple[np.ndarray, int]:
        text = (text or "").strip()
        if not text:
            raise EngineError("Nothing to read.")
        # Wanted from before it loads until it is done, so nothing pushes it out in between.
        with self.want():
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
                finally:
                    # In use counts from the end of the last request.
                    self._last_used = time.time()

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
            # Why it couldn't be loaded the last time it was asked for ("" since it last loaded): AI Write's
            # Settings says so in plain words, with the fix.
            "loadError": self._load_error,
            "voices": count,
            "loadSeconds": round(self._load_seconds, 2) if self.loaded else 0,
            "requests": self._requests,
        }

    def _available(self) -> tuple[bool, str]:
        """Can this engine be used here? `ready` in the status comes from this, not
        from whether the model happens to be in memory."""
        return True, ""


# Why a lower-priority engine didn't load: a higher-priority one was waiting for the graphics card.
GIVE_WAY = "The voices needed the graphics card first. Try again once they have finished."


class _Wanted:
    def __init__(self, engine: Engine) -> None:
        self.engine = engine

    def __enter__(self) -> None:
        with self.engine._wanted_lock:
            self.engine._wanted += 1

    def __exit__(self, *_exc) -> None:
        with self.engine._wanted_lock:
            self.engine._wanted -= 1


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
