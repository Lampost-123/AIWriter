# Adapted from mcreader-v2, tts/tests/fake_worker_side.py and fake_server_side.py (Adam's rule, 2 October 2026: only
# speech code is reused).
"""Checks of the voice worker's safety nets, with no graphics card and no Breeze: when a failure means restarting,
how long a line may run, and that a worker that never answers is stopped.

Run from speech-server/ with any Python that has numpy (torch too, for the restart checks):
    python tests/worker_checks.py
It prints ok or FAIL per check and exits 1 on any failure.
"""
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

# Nothing here may touch a real speech folder.
_scratch = tempfile.mkdtemp(prefix="aiwrite-worker-checks-")
os.environ["AIWRITE_SPEECH_HOME"] = _scratch
os.environ["AIWRITE_BREEZE_CODE"] = str(Path(_scratch) / "models" / "breeze" / "code")
os.environ["AIWRITE_SPEECH_VOICES"] = str(Path(_scratch) / "voices")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

failures: list[str] = []


def check(what: str, ok: bool) -> None:
    print(("ok   " if ok else "FAIL ") + what, file=sys.stderr)
    if not ok:
        failures.append(what)


try:
    import soundfile  # noqa: F401
except ImportError:
    # Only written with, never here: a stand-in lets the worker import in a Python without it.
    import types

    sys.modules["soundfile"] = types.ModuleType("soundfile")

from app.workers import _common, breeze  # noqa: E402

# How long a line may run (frame_cap): 6 s at least, 1.6 frames a character plus 3 s, never past MAX_FRAMES.
check("a word gets 6 s", breeze.frame_cap("Hi.") == 75)
check("a long line gets 1.6 frames a character plus 3 s", breeze.frame_cap("x" * 300) == 518)
check("no line runs past MAX_FRAMES", breeze.frame_cap("x" * 5000) == breeze.MAX_FRAMES)
check("the compile caches live with Breeze, not elsewhere", os.environ["TORCHINDUCTOR_CACHE_DIR"].startswith(str(breeze.CODE.parent)))
check("torch's own launcher is off (it overflows on Windows)", os.environ["TORCHINDUCTOR_USE_STATIC_CUDA_LAUNCHER"] == "0")

try:
    import torch
except Exception:  # noqa: BLE001
    torch = None
    print("skip the restart checks: no torch in this Python", file=sys.stderr)
if torch is not None:
    g = _common._gpu_trouble
    check("a CUDA error restarts", g(RuntimeError("CUDA error: an illegal memory access was encountered"), 0) == (True, 0))
    check("a device-side assert restarts", g(RuntimeError("device-side assert triggered"), 0) == (True, 0))
    check("a first out-of-memory carries on", g(torch.OutOfMemoryError("CUDA out of memory. Tried to allocate"), 0) == (False, 1))
    check("a second out-of-memory in a row restarts", g(torch.OutOfMemoryError("CUDA out of memory."), 1) == (True, 2))
    check("an ordinary error neither restarts nor counts", g(ValueError("no words"), 1) == (False, 0))

# The watchdog: a worker that takes the line and never answers is stopped, and the next line starts a fresh one.
from app.engines import worker_engine  # noqa: E402
from app.engines.base import EngineError  # noqa: E402

worker_engine.REPLY_SECONDS = 1.0
worker_engine.REPLY_SECONDS_PER_CHAR = 0.0
silent = subprocess.Popen(
    [sys.executable, "-c", "import sys, time; sys.stdin.readline(); time.sleep(60)"],
    stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, encoding="utf-8",
)
engine = worker_engine.WorkerEngine.__new__(worker_engine.WorkerEngine)
engine.name = "Fake"
engine._model = silent
t0 = time.perf_counter()
try:
    engine._synth(silent, "Hello there.", "", 1.0, {})
    check("a hung worker is stopped", False)
except EngineError as exc:
    took = time.perf_counter() - t0
    check("a hung worker is stopped in its time", took < 15)
    check("and says so in plain words", "gave no answer" in str(exc))
check("and is gone, holding nothing", silent.poll() is not None and engine._model is None)

# A worker that asks to be restarted (its graphics card is in a bad state) is let go after it answers.
asks = subprocess.Popen(
    [sys.executable, "-c", "import sys; sys.stdin.readline(); print('{\"error\": \"RuntimeError: CUDA error\", \"restart\": true}', flush=True); sys.stdin.readline()"],
    stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, encoding="utf-8",
)
engine._model = asks
try:
    engine._synth(asks, "Hello there.", "", 1.0, {})
    check("a worker's error is passed on", False)
except EngineError as exc:
    check("a worker's error is passed on", "CUDA error" in str(exc))
check("a worker that asks to restart is let go", asks.poll() is not None and engine._model is None)

print(f"{len(failures)} failed" if failures else "all ok", file=sys.stderr)
sys.exit(1 if failures else 0)
