# Adapted from mcreader-v2, tts/app/engines/worker_engine.py (Adam's rule, 2 October 2026: only speech code is reused).
"""An engine that runs in its own Python environment.

Breeze pins a transformers the server's own environment does not carry, so it gets
venvs/breeze and a worker process that this class talks to over stdin/stdout, one JSON
line per request. The audio comes back as base64 float32 at the worker's sample rate.

Only one GPU engine is kept in memory at a time (see `Engine.load`).
"""

import base64
import json
import logging
import os
import subprocess
import sys
from typing import Any

import numpy as np

from .. import config
from .base import Engine, EngineError

log = logging.getLogger("aiwrite_speech.worker")


class WorkerEngine(Engine):
    #: Set by subclasses: the module run as `python -m app.workers.<worker>`.
    worker = ""
    gpu = True
    #: What the worker said it runs on (the graphics card's name, or "cpu") the last time it loaded.
    device_name = ""

    def _python(self):
        return config.breeze_python()

    def _available(self) -> tuple[bool, str]:
        if not self._python().is_file():
            return False, "Not downloaded yet. Download the voices in AI Write's Settings, Read aloud and dictation."
        return True, ""

    def _load(self) -> Any:
        ok, why = self._available()
        if not ok:
            raise RuntimeError(why)
        env = config.child_env({
            "HF_HOME": str(config.BREEZE_HF_HOME),
            "AIWRITE_BREEZE_CODE": str(config.BREEZE_CODE),
            "AIWRITE_SPEECH_VOICES": str(config.VOICES),
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
        # The worker prints one line once the model is on the graphics card.
        first = proc.stdout.readline()
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

    def unload(self) -> None:
        proc = self._model
        super().unload()
        if proc is not None:
            try:
                proc.stdin.close()
                proc.wait(timeout=10)
            except Exception:  # noqa: BLE001
                proc.kill()

    def _synth(self, proc, text: str, voice: str, speed: float, params: dict) -> tuple[np.ndarray, int]:
        req = json.dumps({"text": text, "voice": voice, "speed": speed, "params": params}, ensure_ascii=False)
        try:
            proc.stdin.write(req + "\n")
            proc.stdin.flush()
            line = proc.stdout.readline()
        except (OSError, ValueError) as exc:
            self._model = None
            raise EngineError(f"{self.name} stopped: {exc}") from exc
        if not line:
            self._model = None
            raise EngineError(f"{self.name} stopped; it starts again with the next line.")
        out = json.loads(line)
        if out.get("error"):
            raise EngineError(out["error"])
        samples = np.frombuffer(base64.b64decode(out["b64"]), dtype=np.float32)
        return samples, int(out["sr"])
