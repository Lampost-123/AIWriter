# Adapted from mcreader-v2, tts/app/engines/worker_engine.py (Adam's rule, 2 October 2026: only speech code is reused).
"""An engine that runs in its own Python environment.

Breeze pins a transformers the server's own environment does not carry, so it gets
venvs/breeze and a worker process that this class talks to over stdin/stdout, one JSON
line per request. The audio comes back as base64 float32 at the worker's sample rate.

The GPU engines share the graphics card: one that won't fit beside the others has them let go first (see
`Engine.load`). AI Write's sound effects worker (app/workers/sound.py) is one too, in venvs/sound.
"""

import base64
import json
import logging
import os
import subprocess
import sys
import threading
from typing import Any

import numpy as np

from .. import config
from . import base
from .base import GIVE_WAY, Engine, EngineBusy, EngineError

log = logging.getLogger("aiwrite_speech.worker")

# How long a worker has to answer one line before it is taken for hung (a CUDA hang, a driver reset) and stopped, so
# the next line starts a fresh one instead of every clip waiting forever (from MCreader). Generous: a first use may
# design a voice, or load the word check, before it answers.
REPLY_SECONDS = 180.0
REPLY_SECONDS_PER_CHAR = 0.3


class WorkerEngine(Engine):
    #: Set by subclasses: the module run as `python -m app.workers.<worker>`.
    worker = ""
    gpu = True
    #: What the worker said it runs on (the graphics card's name, or "cpu") the last time it loaded.
    device_name = ""

    def __init__(self) -> None:
        super().__init__()
        # The worker being started (until it says hello), and whether it was stopped for a higher-priority engine.
        self._starting: subprocess.Popen | None = None
        self._aborted = False

    def _python(self):
        return config.breeze_python()

    def _env(self) -> dict:
        """What the worker is told, on top of the offline environment every child process gets."""
        return {
            "HF_HOME": str(config.BREEZE_HF_HOME),
            "AIWRITE_BREEZE_CODE": str(config.BREEZE_CODE),
            "AIWRITE_SPEECH_VOICES": str(config.VOICES),
        }

    def _available(self) -> tuple[bool, str]:
        if not self._python().is_file():
            return False, "Not downloaded yet. Download the voices in AI Write's Settings, Read aloud and dictation."
        return True, ""

    def _load(self) -> Any:
        ok, why = self._available()
        if not ok:
            raise RuntimeError(why)
        env = config.child_env({
            **self._env(),
            # The worker watches this process and ends with it, even in the middle of a sentence.
            "AIWRITE_SPEECH_PARENT": str(os.getpid()),
        })
        proc = subprocess.Popen(
            [str(self._python()), "-u", "-m", f"app.workers.{self.worker}"],
            cwd=str(config.ROOT),
            env=env,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=sys.stderr,
            text=True,
            encoding="utf-8",
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        # Kept where a higher-priority engine can stop it (_abort_start), unless one is already waiting.
        with base._WANT_LOCK:
            self._aborted = self.gives_way()
            if self._aborted:
                proc.kill()
            else:
                self._starting = proc
        try:
            # The worker prints one line once the model is on the graphics card.
            first = proc.stdout.readline() if not self._aborted else ""
        finally:
            with base._WANT_LOCK:
                self._starting = None
        if self._aborted:
            proc.kill()
            proc.wait()
            raise EngineBusy(GIVE_WAY)
        if not first:
            proc.kill()
            raise RuntimeError("it stopped while loading. The details are in the speech engine's log (logs/server.log).")
        hello = json.loads(first)
        if hello.get("error"):
            proc.kill()
            raise RuntimeError(hello["error"])
        self.device_name = str(hello.get("device") or "")
        log.info("%s worker ready (%s)", self.name, hello.get("device", "?"))
        return proc

    def _abort_start(self) -> None:
        # Called with base._WANT_LOCK held.
        if self._starting is not None:
            self._aborted = True
            try:
                self._starting.kill()
            except OSError:
                pass

    def unload(self) -> None:
        proc = self._model
        super().unload()
        if proc is not None:
            try:
                proc.stdin.close()
                proc.wait(timeout=10)
            except Exception:  # noqa: BLE001
                proc.kill()

    def _drop(self, proc) -> None:
        """Let go of a worker that died, hung or asked to be restarted: ended for good, so it holds no graphics card
        memory beside the one the next line starts."""
        self._model = None
        try:
            proc.kill()
            proc.wait(timeout=10)
        except Exception:  # noqa: BLE001 - already gone
            pass

    def _synth(self, proc, text: str, voice: str, speed: float, params: dict) -> tuple[np.ndarray, int]:
        req = json.dumps({"text": text, "voice": voice, "speed": speed, "params": params}, ensure_ascii=False)
        limit = REPLY_SECONDS + REPLY_SECONDS_PER_CHAR * len(text)
        hung = threading.Event()

        def stuck() -> None:
            hung.set()
            proc.kill()

        watchdog = threading.Timer(limit, stuck)
        watchdog.daemon = True
        try:
            proc.stdin.write(req + "\n")
            proc.stdin.flush()
            watchdog.start()
            line = proc.stdout.readline()
        except (OSError, ValueError) as exc:
            self._drop(proc)
            raise EngineError(f"{self.name} stopped: {exc}") from exc
        finally:
            watchdog.cancel()
        if not line:
            self._drop(proc)
            if hung.is_set():
                raise EngineError(f"{self.name} gave no answer in {limit:.0f} s, so it was stopped; it starts again with the next line.")
            raise EngineError(f"{self.name} stopped; it starts again with the next line.")
        out = json.loads(line)
        # A worker whose graphics card state can't be trusted any more says so, then exits.
        if out.get("restart"):
            self._drop(proc)
        if out.get("error"):
            raise EngineError(out["error"])
        samples = np.frombuffer(base64.b64decode(out["b64"]), dtype=np.float32)
        return samples, int(out["sr"])
