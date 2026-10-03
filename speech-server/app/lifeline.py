"""Ending with the process that started us.

AI Write stops the server as it quits, but if AI Write is ended some other way (a crash, Task Manager)
the server would stay behind, holding its port and the graphics card. So the server watches AI Write's
process, and the Breeze worker watches the server's, and each ends itself when the one it watches goes.
"""

import os
import threading
import time


def _wait_windows(pid: int) -> bool:
    """Blocks until the process ends. False if it can't be watched (already gone, or no access)."""
    import ctypes

    k32 = ctypes.windll.kernel32
    handle = k32.OpenProcess(0x00100000, False, pid)  # SYNCHRONIZE
    if not handle:
        return False
    k32.WaitForSingleObject(handle, 0xFFFFFFFF)
    return True


def _alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def end_with(pid: int, before_exit=None) -> None:
    """Ends this process soon after process `pid` ends. Does nothing for pid 0."""
    if not pid:
        return

    def watch() -> None:
        if os.name == "nt":
            if not _wait_windows(pid):
                return
        else:
            while _alive(pid):
                time.sleep(2)
        if before_exit is not None:
            try:
                before_exit()
            except Exception:  # noqa: BLE001 - leaving anyway
                pass
        os._exit(0)

    threading.Thread(target=watch, name="lifeline", daemon=True).start()
