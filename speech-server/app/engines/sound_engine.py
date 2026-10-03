"""The sound effects: Stable Audio Open, run in venvs/sound by app/workers/sound.py.

Not a voice: it never shows among the engines `/v1/health` lists or the voices, and nothing reads aloud with it.
AI Write asks for one sound at a time (POST /v1/sounds/generate) and keeps what comes back in its own library,
so a sound is made once. The worker makes a few takes one after another on the graphics card and keeps the one
CLAP, on the processor, hears as closest to the description. Measured on an RTX 5070 Ti (nvidia-smi, the whole
worker): about 3.1 GB held between sounds, 3.6 GB at most for an effect and 4.3 GB for 20 seconds of ambience.

It shares the graphics card with the voices, which come first (base.Engine.load): it loads beside them when
there is room, waits while they are reading aloud, and is stopped part way when they need its room. It is let go
sooner than the voices when unused (config.sound_idle_unload_seconds), since sounds are made in batches.

Stability AI Community License: AI Write shows "Powered by Stability AI" wherever the sound effects are offered.
"""

import base64
import json
import re
import time

import numpy as np

from .. import config, downloaded
from .base import EngineBusy, EngineError
from .worker_engine import WorkerEngine

KINDS = ("effect", "ambience")
# How long a sound may be, in seconds: (shortest, longest, when none is asked for).
SECONDS = {"effect": (1.0, 10.0, 3.0), "ambience": (10.0, 30.0, 20.0)}
# How many takes CLAP picks from: (fewest, most, when none is asked for). Each is about 9.5 seconds of work.
TAKES = (1, 4, 3)

NOT_DOWNLOADED = "Not downloaded yet. Download the sound effects in AI Write's Settings, Read aloud and dictation."
PARTLY = "Only partly downloaded. Download the sound effects again in AI Write's Settings, Read aloud and dictation."
INTERRUPTED = "The voices needed the graphics card, so this sound was stopped part way. Try again once they have finished."
FULL = "The graphics card was too full to make this sound just now. Try again in a little while."
OUT_OF_MEMORY = re.compile(r"out of memory|OutOfMemoryError|CUDA_ERROR_OUT_OF_MEMORY", re.IGNORECASE)


def clamp_seconds(kind: str, seconds) -> float:
    low, high, default = SECONDS[kind]
    try:
        value = float(seconds)
    except (TypeError, ValueError):
        return default
    if not np.isfinite(value):
        return default
    return round(min(high, max(low, value)), 2)


def clamp_takes(takes) -> int:
    low, high, default = TAKES
    try:
        value = int(takes)
    except (TypeError, ValueError):
        return default
    return min(high, max(low, value))


class SoundEngine(WorkerEngine):
    id = "sound"
    name = "Stable Audio Open"
    blurb = "Makes sound effects and ambience from a description. Graphics card, about 4.5 GB. Stability AI Community License."
    worker = "sound"
    gpu = True
    # Measured (see above): 3090 MiB at rest, 4290 at most (20 s of ambience; its pieces are decoded the same size
    # whatever the length), with room to spare.
    needs_mb = 4500
    holds_mb = 3100
    priority = 0

    def __init__(self) -> None:
        super().__init__()
        # Set when the worker is stopped part way through a sound (the voices needed its room).
        self._interrupted = False

    def _python(self):
        return config.sound_python()

    def _env(self) -> dict:
        return {
            # The same Hugging Face cache layout as the voices'; the worker loads from the folders below, offline.
            "HF_HOME": str(config.HF_HOME),
            "AIWRITE_SOUND_MODEL": str(downloaded.sound_dir(config.HOME) or ""),
            "AIWRITE_CLAP_MODEL": str(downloaded.clap_dir(config.HOME) or ""),
        }

    def _available(self) -> tuple[bool, str]:
        if not self._python().is_file():
            return False, NOT_DOWNLOADED
        if not downloaded.sound_complete(config.HOME):
            return False, PARTLY
        return True, ""

    def available(self) -> tuple[bool, str]:
        """Downloaded and checked, or why not, in plain words."""
        return self._available()

    def unload(self) -> None:
        proc = self._model
        if proc is not None and self.busy:
            # In the middle of a sound: stopped at once, rather than after its takes (the voices are waiting).
            self._interrupted = True
            try:
                proc.kill()
            except OSError:
                pass
        super().unload()

    def make(self, prompt: str, kind: str, seconds: float, takes: int, seed: int | None) -> dict:
        """One sound: {"samples": float32 (frames, channels), "sr", "score", "seconds"}. One at a time."""
        prompt = (prompt or "").strip()
        if not prompt:
            raise EngineError("Say what the sound is.")
        if kind not in KINDS:
            raise EngineError("A sound is an effect or ambience.")
        with self.want(), self._run_lock:
            # Before loading: the worker can be stopped for the voices from here on, and that is said as "try later".
            self._interrupted = False
            proc = self.load()
            self._last_used = time.time()
            self._requests += 1
            req = json.dumps(
                {"prompt": prompt, "kind": kind, "seconds": seconds, "takes": takes, "seed": seed},
                ensure_ascii=False,
            )
            try:
                proc.stdin.write(req + "\n")
                proc.stdin.flush()
                line = proc.stdout.readline()
            except (OSError, ValueError):
                line = ""
            finally:
                # A batch counts from its last sound, so the model isn't let go in the middle of one.
                self._last_used = time.time()
            if not line:
                if self._interrupted:
                    raise EngineBusy(INTERRUPTED)
                self._model = None
                raise EngineError(f"{self.name} stopped while making that sound; it starts again with the next one.")
            try:
                out = json.loads(line)
            except ValueError:
                # Cut off part way: stopped for the voices, or it died.
                if self._interrupted:
                    raise EngineBusy(INTERRUPTED) from None
                self._model = None
                raise EngineError(f"{self.name} stopped while making that sound; it starts again with the next one.") from None
            if out.get("error"):
                if OUT_OF_MEMORY.search(str(out["error"])):
                    # The card filled up (beside the voices, say): its memory goes back now, and the sound waits.
                    self.unload()
                    raise EngineBusy(FULL)
                raise EngineError(f"{self.name} couldn't make that sound: {out['error']}")
            channels = int(out.get("channels") or 1)
            samples = np.frombuffer(base64.b64decode(out["b64"]), dtype=np.float32).reshape(-1, channels)
            return {
                "samples": samples,
                "sr": int(out["sr"]),
                "score": float(out.get("score") or 0.0),
                "seconds": float(out.get("seconds") or samples.shape[0] / int(out["sr"])),
            }

    def sound_status(self, beside: bool) -> dict:
        """What /v1/health says about the sound effects."""
        ok, why = self._available()
        return {
            "ready": ok,
            "loaded": self.loaded,
            "detail": self._load_error or why,
            # Why it couldn't be loaded the last time it was asked for ("" since it last loaded).
            "loadError": self._load_error,
            "beside": beside,
        }
