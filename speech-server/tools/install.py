# Adapted from mcreader-v2, tts/tools/install_engine.py (Adam's rule, 2 October 2026: only speech code is
# reused); the dictation downloads are AI Write's own.
"""The download steps AI Write runs that need Python: one step per run, each safe to run again.

AI Write (src/main/speech/plan.ts) runs every step itself, one process at a time, shows its output and
can stop it; pip steps it runs directly. This tool does the rest:

    python tools/install.py check-server
    python tools/install.py breeze-torch
    python tools/install.py breeze-code --root <folder>       Breeze's inference code (a pinned commit)
    python tools/install.py breeze-weights --root <folder>    the weights (about 8 GB), HF_TOKEN if asked
    python tools/install.py breeze-check
    python tools/install.py parakeet-model --home <folder>
    python tools/install.py whisper-model --home <folder>
    python tools/install.py check-dictation parakeet|whisper

Lines starting "@@" are for AI Write: "@@progress <done> <total>" (bytes), "@@licence <page>" (Hugging Face
wants a licence accepted first), "@@gpu <card name or none>" and "@@error <plain words>".
Exit codes: 0 done, 1 failed, 3 Hugging Face wants its licence accepted.
"""

import argparse
import io
import os
import shutil
import subprocess
import sys
import tarfile
import threading
import time
import urllib.request
import zipfile
from pathlib import Path

TORCH_INDEX = "https://download.pytorch.org/whl/cu128"
# What Breeze was tested on; the CUDA 12.8 build has kernels for every NVIDIA card from the RTX 20s to the 50s.
TORCH = ["torch==2.9.1", "torchaudio==2.9.1"]

# github.com/breezeblue-ai/breeze-tts at the commit this was written against (2026-09-10).
BREEZE_COMMIT = "008f769016b0a24711becd7a4925030bc93f608c"
BREEZE_ZIP = f"https://github.com/breezeblue-ai/breeze-tts/archive/{BREEZE_COMMIT}.zip"
# The weights, named as MCreader names them, so a copy made by MCreader is the same files.
BREEZE_REPO = "BreezeBlue/breeze-tts-2"
# Only what speaking needs: not the logo and leaderboard pictures.
BREEZE_IGNORE = ["assets/*", "*.md", ".gitattributes"]
BREEZE_MODULES = ("torch", "torchaudio", "librosa", "transformers", "qwen_tts", "huggingface_hub", "soundfile")

PARAKEET_URL = (
    "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/"
    "sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8.tar.bz2"
)
WHISPER_REPO = "Systran/faster-whisper-base.en"


def say(line: str) -> None:
    print(line, flush=True)


def fail(plain: str, code: int = 1) -> int:
    say(f"@@error {plain}")
    return code


class Progress:
    """Prints "@@progress done total" at most twice a second, and a line for people every few seconds."""

    def __init__(self, what: str, total: int) -> None:
        self.what, self.total = what, total
        self.last = 0.0
        self.last_human = 0.0

    def __call__(self, done: int, force: bool = False) -> None:
        now = time.time()
        if not force and now - self.last < 0.5:
            return
        self.last = now
        say(f"@@progress {done} {self.total}")
        if force or now - self.last_human >= 4:
            self.last_human = now
            if self.total:
                say(f"{self.what}: {min(100, done * 100 // self.total)}% ({mb(done)} of {mb(self.total)})")
            else:
                say(f"{self.what}: {mb(done)}")


def mb(n: int) -> str:
    return f"{n / 1e9:.1f} GB" if n >= 1e9 else f"{n / 1e6:.0f} MB"


def fetch(url: str, dest: Path, what: str) -> None:
    """Downloads `url` to `dest` with progress, through a .part file, so a stopped download leaves nothing half-made."""
    part = dest.with_name(dest.name + ".part")
    with urllib.request.urlopen(url, timeout=60) as r:
        total = int(r.headers.get("Content-Length") or 0)
        progress = Progress(what, total)
        done = 0
        with open(part, "wb") as out:
            while True:
                chunk = r.read(1 << 20)
                if not chunk:
                    break
                out.write(chunk)
                done += len(chunk)
                progress(done)
        progress(done, force=True)
    part.replace(dest)


def folder_bytes(root: Path) -> int:
    """Bytes in files under `root`, not counting links (Hugging Face's cache links snapshots to blobs)."""
    total = 0
    for dirpath, _dirs, files in os.walk(root):
        for name in files:
            try:
                st = os.lstat(os.path.join(dirpath, name))
            except OSError:
                continue
            if not os.path.islink(os.path.join(dirpath, name)):
                total += st.st_size
    return total


def run_with_progress(work, root: Path, what: str, total: int) -> None:
    """Runs `work()` on a thread while reporting how much has arrived under `root`."""
    errors: list[BaseException] = []

    def go() -> None:
        try:
            work()
        except BaseException as exc:  # noqa: BLE001 - handed to the caller
            errors.append(exc)

    thread = threading.Thread(target=go, daemon=True)
    thread.start()
    progress = Progress(what, total)
    while thread.is_alive():
        thread.join(0.5)
        progress(folder_bytes(root) if root.exists() else 0)
    progress(total or folder_bytes(root), force=True)
    if errors:
        raise errors[0]


# --- the server ------------------------------------------------------------


def check_server() -> int:
    missing = [m for m in ("fastapi", "uvicorn", "soundfile", "numpy") if not can_import(sys.executable, m)]
    if missing:
        say(f"Missing: {', '.join(missing)}")
        return fail("Part of the speech engine didn't install. Try again; if it keeps failing, remove its downloads in More and download it again.")
    say("The speech engine is ready.")
    return 0


def can_import(python: str, module: str) -> bool:
    return subprocess.call([python, "-c", f"import {module}"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL) == 0


# --- Breeze ---------------------------------------------------------------


def torch_state() -> tuple[str, str]:
    """(version without its build tag, CUDA version or "") of the torch installed here, or ("", "")."""
    try:
        out = subprocess.run(
            [sys.executable, "-c", "import torch; print(torch.__version__.split('+')[0]); print(torch.version.cuda or '')"],
            capture_output=True, text=True, timeout=300,
        )
    except (OSError, subprocess.SubprocessError):
        return "", ""
    if out.returncode != 0:
        return "", ""
    lines = (out.stdout.strip().splitlines() + ["", ""])[:2]
    return lines[0].strip(), lines[1].strip()


def breeze_torch() -> int:
    """Makes sure PyTorch is the pinned CUDA build: another package may have pulled in the plain one."""
    version, cuda = torch_state()
    want = TORCH[0].split("==", 1)[1]
    if version == want and cuda:
        say(f"PyTorch {version} for CUDA {cuda} is installed.")
        return 0
    say("Putting the graphics card build of PyTorch back in place (about 3 GB)…")
    code = subprocess.call([
        sys.executable, "-m", "pip", "install", "--no-input", "--disable-pip-version-check", "--progress-bar", "raw",
        "--force-reinstall", "--no-deps", *TORCH, "--index-url", TORCH_INDEX,
    ])
    if code:
        return fail("PyTorch didn't download. Check the internet connection, then Try again.")
    return 0


def breeze_code(root: Path) -> int:
    """Unpack the pinned breeze-tts commit into models/breeze/code, replacing any older copy."""
    target = root / "models" / "breeze" / "code"
    stamp = target / ".commit"
    if (target / "breeze_infer").is_dir() and stamp.is_file() and stamp.read_text().strip() == BREEZE_COMMIT:
        say("Breeze's code is already here.")
        return 0
    say(f"Downloading Breeze's code ({BREEZE_COMMIT[:7]})…")
    target.parent.mkdir(parents=True, exist_ok=True)
    archive = target.parent / "breeze-code.zip"
    try:
        fetch(BREEZE_ZIP, archive, "Breeze's code")
        fresh = target.parent / "code.new"
        if fresh.exists():
            shutil.rmtree(fresh)
        fresh.mkdir(parents=True)
        with zipfile.ZipFile(archive) as z:
            prefix = z.namelist()[0].split("/", 1)[0] + "/"
            for name in z.namelist():
                rel = name[len(prefix):]
                # Only the code: the leaderboard images and tests are not needed to speak.
                if not rel or rel.endswith("/") or rel.startswith(("assets/", "tests/", "docker/")):
                    continue
                out = fresh / rel
                out.parent.mkdir(parents=True, exist_ok=True)
                out.write_bytes(z.read(name))
        (fresh / ".commit").write_text(BREEZE_COMMIT)
        if target.exists():
            shutil.rmtree(target)
        fresh.replace(target)
    except (OSError, zipfile.BadZipFile) as exc:
        say(f"Could not download it: {exc}")
        return fail("Breeze's code didn't download. Check the internet connection, then Try again.")
    finally:
        archive.unlink(missing_ok=True)
    say("Breeze's code is in place.")
    return 0


def _gated(exc: BaseException) -> bool:
    text = f"{exc.__class__.__name__} {exc}"
    return any(word in text for word in ("GatedRepo", "401", "403", "gated", "Unauthorized", "Forbidden"))


def breeze_weights(root: Path) -> int:
    """Pull the weights now, so the first sentence read does not (the server never downloads)."""
    from huggingface_hub import HfApi, snapshot_download

    page = f"https://huggingface.co/{BREEZE_REPO}"
    token = os.environ.get("HF_TOKEN") or None
    say(f"Downloading Breeze TTS 2's voices from {page}")
    try:
        info = HfApi().model_info(BREEZE_REPO, files_metadata=True, token=token)
        total = sum(
            (s.size or 0) for s in (info.siblings or [])
            if not any(Path(s.rfilename).match(p) for p in BREEZE_IGNORE)
        )
    except Exception as exc:  # noqa: BLE001
        if _gated(exc):
            say(f"@@licence {page}")
            return 3
        say(f"Could not reach Hugging Face: {exc.__class__.__name__}")
        return fail("Couldn't reach Hugging Face to download the voices. Check the internet connection, then Try again.")
    cache = Path(os.environ.get("HF_HOME") or root / "models" / "hf") / "hub" / f"models--{BREEZE_REPO.replace('/', '--')}"
    try:
        run_with_progress(
            # One file at a time, so a stop leaves one partial file, picked up again by Try again.
            lambda: snapshot_download(BREEZE_REPO, ignore_patterns=BREEZE_IGNORE, max_workers=1, token=token),
            cache,
            "Downloading the voices",
            total,
        )
    except Exception as exc:  # noqa: BLE001
        if _gated(exc):
            say(f"@@licence {page}")
            return 3
        say(f"The download stopped: {exc.__class__.__name__}")
        return fail("The voices didn't finish downloading. Check the internet connection and that there's about 12 GB free, then Try again.")
    say("The voices are downloaded.")
    return 0


def breeze_check() -> int:
    say("Checking the voices…")
    failures = [m for m in BREEZE_MODULES if not can_import(sys.executable, m)]
    for module in BREEZE_MODULES:
        say(f"  {module}: {'missing' if module in failures else 'ok'}")
    try:
        out = subprocess.run(
            [sys.executable, "-c", "import torch; print(torch.cuda.get_device_name(0) if torch.cuda.is_available() else '')"],
            capture_output=True, text=True, timeout=300,
        )
        card = out.stdout.strip().splitlines()[-1].strip() if out.returncode == 0 and out.stdout.strip() else ""
    except (OSError, subprocess.SubprocessError, IndexError):
        card = ""
    say(f"@@gpu {card or 'none'}")
    if failures:
        return fail("Part of the voices didn't install. Try again; if it keeps failing, remove the downloads in More and download them again.")
    say("The voices are ready." if card else "The voices are installed, but no NVIDIA graphics card is visible, so they would be far too slow.")
    return 0


# --- dictation ------------------------------------------------------------


def parakeet_model(home: Path) -> int:
    dest = home / "models" / "parakeet"
    dest.mkdir(parents=True, exist_ok=True)
    if any(dest.glob("**/encoder.int8.onnx")):
        say("Parakeet is already downloaded.")
        return 0
    archive = dest / "parakeet.tar.bz2"
    say("Downloading Parakeet (about half a gigabyte to download, once)…")
    try:
        fetch(PARAKEET_URL, archive, "Downloading Parakeet")
        say("Unpacking…")
        with tarfile.open(archive, "r:bz2") as packed:
            try:
                packed.extractall(dest, filter="data")
            except TypeError:  # Python before 3.10.12 has no filter
                packed.extractall(dest)
    except (OSError, tarfile.TarError) as exc:
        say(f"Could not download it: {exc}")
        return fail("Parakeet didn't download. Check the internet connection, then Try again.")
    finally:
        archive.unlink(missing_ok=True)
    if not any(dest.glob("**/encoder.int8.onnx")):
        return fail("Parakeet downloaded, but its files weren't in it. Try again.")
    say("Parakeet is ready.")
    return 0


def whisper_model(home: Path) -> int:
    from huggingface_hub import HfApi, snapshot_download

    root = home / "models" / "whisper"
    root.mkdir(parents=True, exist_ok=True)
    cache = root / f"models--{WHISPER_REPO.replace('/', '--')}"
    say("Downloading Whisper's English model…")
    try:
        info = HfApi().model_info(WHISPER_REPO, files_metadata=True)
        total = sum((s.size or 0) for s in (info.siblings or []) if not s.rfilename.endswith(".md"))
        # The same place and layout faster-whisper looks in (WhisperModel's download_root).
        run_with_progress(lambda: snapshot_download(WHISPER_REPO, cache_dir=str(root), max_workers=1), cache, "Downloading Whisper", total)
    except Exception as exc:  # noqa: BLE001
        say(f"The download stopped: {exc.__class__.__name__}")
        return fail("Whisper didn't download. Check the internet connection, then Try again.")
    if not any(root.glob("**/model.bin")):
        return fail("Whisper downloaded, but its model wasn't in it. Try again.")
    say("Whisper is ready.")
    return 0


def check_dictation(engine: str) -> int:
    module = "sherpa_onnx" if engine == "parakeet" else "faster_whisper"
    if not can_import(sys.executable, module):
        return fail(f"{engine.capitalize()} didn't install. Try again.")
    say(f"{engine.capitalize()} is installed.")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="AI Write's speech downloads.")
    parser.add_argument("step", choices=[
        "check-server", "breeze-torch", "breeze-code", "breeze-weights", "breeze-check",
        "parakeet-model", "whisper-model", "check-dictation",
    ])
    parser.add_argument("engine", nargs="?", choices=["parakeet", "whisper"])
    parser.add_argument("--root", help="Where Breeze's environment, code and weights go.")
    parser.add_argument("--home", help="AI Write's speech folder.")
    args = parser.parse_args()
    root = Path(args.root) if args.root else None
    home = Path(args.home) if args.home else None

    if args.step == "check-server":
        return check_server()
    if args.step == "breeze-torch":
        return breeze_torch()
    if args.step == "breeze-code":
        return breeze_code(root)
    if args.step == "breeze-weights":
        return breeze_weights(root)
    if args.step == "breeze-check":
        return breeze_check()
    if args.step == "parakeet-model":
        return parakeet_model(home)
    if args.step == "whisper-model":
        return whisper_model(home)
    return check_dictation(args.engine or "parakeet")


if __name__ == "__main__":
    raise SystemExit(main())
