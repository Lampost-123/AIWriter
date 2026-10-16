# Adapted from mcreader-v2, tts/app/workers/_common.py (Adam's rule, 2 October 2026: only speech code is reused).
"""The loop every worker runs: load, say hello, then answer one JSON line at a time."""

import base64
import json
import os
import sys
import traceback
from typing import Callable

import numpy as np

TARGET_SR = 24000

# The protocol owns the real stdout. Everything else that prints — libraries
# complaining about a missing `sox`, download bars, warnings — is sent to stderr,
# including C-level writes to fd 1, so it can never corrupt a reply.
_OUT = os.fdopen(os.dup(1), "w", encoding="utf-8", buffering=1)
os.dup2(2, 1)
sys.stdout = sys.stderr


def _die_with_parent() -> None:
    """Exit when the server that spawned us is gone, even mid-sentence.

    Stdin closing covers a clean stop, but a server killed while a worker is
    generating leaves that worker alive afterwards, holding the graphics card.
    """
    from ..lifeline import end_with

    try:
        end_with(int(os.environ.get("AIWRITE_SPEECH_PARENT", "0")))
    except ValueError:
        pass


_die_with_parent()


def _say(obj: dict) -> None:
    _OUT.write(json.dumps(obj) + "\n")
    _OUT.flush()


def _trim_tail(x: np.ndarray, sr: int) -> np.ndarray:
    """Drop trailing near-silence so the next clip starts when the last word ends."""
    if x.size < sr // 5:
        return x
    peak = float(np.max(np.abs(x))) or 1.0
    nz = np.nonzero(np.abs(x) > 0.012 * peak)[0]
    if not len(nz):
        return x
    return x[: min(x.size, int(nz[-1]) + int(sr * 0.18))]


def finish(samples, sr: int, speed: float) -> tuple[np.ndarray, int]:
    """Common tail: mono float32, 24 kHz, pace changed without changing pitch."""
    import librosa

    x = np.asarray(samples, dtype=np.float32).reshape(-1)
    if sr != TARGET_SR:
        x = librosa.resample(x, orig_sr=sr, target_sr=TARGET_SR).astype(np.float32)
        sr = TARGET_SR
    speed = max(0.5, min(2.0, float(speed or 1.0)))
    if abs(speed - 1.0) > 0.01:
        x = librosa.effects.time_stretch(y=x, rate=speed).astype(np.float32)
    return _trim_tail(x, sr), sr


def _gpu_trouble(exc: Exception, out_of_memory: int) -> tuple[bool, int]:
    """(whether the worker must restart, out-of-memory errors in a row) after a failed request (from MCreader).

    After a CUDA error (an illegal memory access, a device-side assert) the context is broken and every later line
    fails too; only a fresh process recovers. Running out of memory once is let go after freeing the cache, twice in a
    row is taken for the same.
    """
    try:
        import torch
    except Exception:  # noqa: BLE001 - a worker without torch has no GPU to break
        return False, 0
    text = f"{exc.__class__.__name__}: {exc}"
    oom = getattr(torch, "OutOfMemoryError", None) or getattr(torch.cuda, "OutOfMemoryError", ())
    if isinstance(exc, oom) or "out of memory" in text.lower():
        torch.cuda.empty_cache()
        return out_of_memory >= 1, out_of_memory + 1
    broken = any(sign in text for sign in ("CUDA error", "illegal memory access", "device-side assert", "CUBLAS_STATUS", "cuDNN error"))
    return broken, 0


def serve(load: Callable[[], object], synth: Callable[[object, str, str, float, dict], tuple[np.ndarray, int]]) -> None:
    """`load()` returns the model; `synth(model, text, voice, speed, params)` returns (samples, sr)."""
    try:
        model = load()
    except Exception as exc:  # noqa: BLE001
        traceback.print_exc()
        _say({"error": f"{exc.__class__.__name__}: {exc}"})
        return
    try:
        import torch

        device = torch.cuda.get_device_name(0) if torch.cuda.is_available() else "cpu"
    except Exception:  # noqa: BLE001
        device = "?"
    _say({"ok": True, "device": device})
    out_of_memory = 0
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
            samples, sr = synth(model, req.get("text", ""), req.get("voice", ""), req.get("speed", 1.0), req.get("params") or {})
            samples, sr = finish(samples, sr, req.get("speed", 1.0))
            _say({"sr": sr, "b64": base64.b64encode(samples.tobytes()).decode("ascii")})
            out_of_memory = 0
        except Exception as exc:  # noqa: BLE001
            traceback.print_exc()
            restart, out_of_memory = _gpu_trouble(exc, out_of_memory)
            _say({"error": f"{exc.__class__.__name__}: {exc}", **({"restart": True} if restart else {})})
            if restart:
                print("Worker: the graphics card is in a bad state; exiting so the next line starts it fresh.", file=sys.stderr, flush=True)
                os._exit(1)
