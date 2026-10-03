"""The NVIDIA graphics card, as nvidia-smi (which comes with its driver) tells it: its name, and how much of its
memory is free now.

Free memory decides whether a model can load beside the ones already loaded (base.Engine.load): the voices
(about 9.5 GB) and the sound effects (about 4.5 GB at their most) don't fit together on a 16 GB card beside the
desktop's own share, so there one is let go for the other. Nothing here needs torch: the server's own environment has none.
"""

import os
import shutil
import subprocess
import threading
import time
from pathlib import Path

from .. import config

# How long an answer about free memory is trusted. Loading and letting go of a model forgets it at once.
FREE_FOR_SECONDS = 3.0
# Room kept spare beyond what a model needs: the desktop's share moves, and CUDA wants a little to start.
MARGIN_MB = 512

_lock = threading.Lock()
_smi: list[str | None] = []
_free: tuple[float, int | None] | None = None


def smi() -> str | None:
    """Where nvidia-smi is, looked for once; None when there is no NVIDIA driver."""
    if _smi:
        return _smi[0]
    found = shutil.which("nvidia-smi")
    if not found and config.WINDOWS:
        program_files = os.environ.get("ProgramFiles", r"C:\Program Files")
        older = Path(program_files) / "NVIDIA Corporation" / "NVSMI" / "nvidia-smi.exe"
        found = str(older) if older.is_file() else None
    _smi.append(found)
    return found


def ask(query: str) -> str:
    """nvidia-smi's first line for `query` ("name", "memory.free"...), or "" when it can't say."""
    found = smi()
    if not found:
        return ""
    try:
        out = subprocess.run(
            [found, f"--query-gpu={query}", "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=10,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
    except (OSError, subprocess.SubprocessError):
        return ""
    if out.returncode != 0:
        return ""
    return next((line.strip() for line in out.stdout.splitlines() if line.strip()), "")


def free_mb(fresh: bool = False) -> int | None:
    """The first card's free memory in MiB, or None when it isn't known (no NVIDIA card, or nvidia-smi failed).
    Asked at most every few seconds: /v1/health says whether the sound effects fit beside the voices."""
    global _free
    with _lock:
        now = time.monotonic()
        if not fresh and _free is not None and now - _free[0] < FREE_FOR_SECONDS:
            return _free[1]
        text = ask("memory.free")
        try:
            value: int | None = int(float(text))
        except ValueError:
            value = None
        _free = (now, value)
        return value


def forget() -> None:
    """A model was loaded or let go: the next question about free memory asks again."""
    global _free
    with _lock:
        _free = None
