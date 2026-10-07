# Adapted from mcreader-v2, tts/tools/install_engine.py (Adam's rule, 2 October 2026: only speech code is
# reused); the dictation downloads are AI Write's own.
"""The download steps AI Write runs that need Python: one step per run, each safe to run again.

AI Write (src/main/speech/plan.ts) runs every step itself, one process at a time, shows its output and
can stop it; pip steps it runs directly. This tool does the rest:

    python tools/install.py check-server
    python tools/install.py breeze-torch
    python tools/install.py breeze-code --root <folder>       Breeze's inference code (a pinned commit)
    python tools/install.py breeze-weights --root <folder>    the weights (about 8 GB), HF_TOKEN if asked
    python tools/install.py breeze-check --root <folder>      checks it all, then leaves models/breeze/.ready
    python tools/install.py sound-torch                       the graphics card part of the sound effects
    python tools/install.py sound-weights --root <folder>     Stable Audio Open and CLAP (about 6 GB), HF_TOKEN
    python tools/install.py sound-check --root <folder>       checks it all, then leaves models/sound/.ready
    python tools/install.py studio-voices --root <folder>     the studio voices (about 3 GB from the EARS dataset)
    python tools/install.py check-model --root <folder>       the word check's listener (distil-whisper, about 670 MB)
    python tools/install.py studio-check --root <folder>      checks them, then leaves voices/library/.ready
    python tools/install.py parakeet-model --home <folder>
    python tools/install.py whisper-model --home <folder>
    python tools/install.py check-dictation parakeet|whisper

Lines starting "@@" are for AI Write: "@@progress <done> <total>" (bytes), "@@licence <page>" (Hugging Face
wants a licence accepted first), "@@key" (Hugging Face turned the saved key down), "@@gpu <card name or
none>", "@@error <plain words>" and "@@keep-environment" (a check failed on missing files, not on the
environment: Try again downloads them again without setting the environment up afresh).
Exit codes: 0 done, 1 failed, 3 Hugging Face wants its licence accepted or a better key.

What counts as downloaded is app/downloaded.py, shared with the server: a step stopped part way never
leaves something that reads as done.
"""

import argparse
import io
import os
import re
import shutil
import subprocess
import sys
import tarfile
import threading
import time
import urllib.request
import zipfile
from pathlib import Path

# The server's own package, for app/downloaded.py (standard library only, so every step can use it).
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import downloaded  # noqa: E402

TORCH_INDEX = "https://download.pytorch.org/whl/cu128"
# What Breeze was tested on; the CUDA 12.8 build has kernels for every NVIDIA card from the RTX 20s to the 50s.
TORCH = ["torch==2.9.1", "torchaudio==2.9.1"]
# The sound effects: the same PyTorch as the voices, with the torchvision built for it (diffusers imports it).
SOUND_TORCH = [*TORCH, "torchvision==0.24.1"]

# github.com/breezeblue-ai/breeze-tts at the commit this was written against (2026-09-10).
BREEZE_COMMIT = "008f769016b0a24711becd7a4925030bc93f608c"
BREEZE_ZIP = f"https://github.com/breezeblue-ai/breeze-tts/archive/{BREEZE_COMMIT}.zip"
# The weights, named as MCreader names them, so a copy made by MCreader is the same files.
BREEZE_REPO = downloaded.BREEZE_REPO
# Only what speaking needs: not the logo and leaderboard pictures.
BREEZE_IGNORE = ["assets/*", "*.md", ".gitattributes"]
BREEZE_MODULES = ("torch", "torchaudio", "librosa", "transformers", "qwen_tts", "huggingface_hub", "soundfile")

SOUND_REPO = downloaded.SOUND_REPO
CLAP_REPO = downloaded.CLAP_REPO
# laion/larger_clap_general keeps only a pickled copy of its weights on main; Hugging Face's own converter made the
# same weights as safetensors at this commit (refs/pr/2), which load without running anything from the file.
CLAP_REVISION = "16c8cc3159a3c8a31e8ff5ef1f66b0d9ab3667db"
# torchsde: diffusers offers Stable Audio Open's scheduler only with it.
SOUND_MODULES = ("torch", "torchaudio", "torchvision", "diffusers", "transformers", "torchsde", "soundfile", "numpy")
# What the worker actually imports from them.
SOUND_IMPORTS = "from diffusers import StableAudioPipeline; from transformers import ClapModel, ClapProcessor; import torchaudio.functional"

PARAKEET_URL = (
    "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/"
    "sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8.tar.bz2"
)
WHISPER_REPO = downloaded.WHISPER_REPO


def say(line: str) -> None:
    print(line, flush=True)


def fail(plain: str, code: int = 1) -> int:
    say(f"@@error {plain}")
    return code


class Progress:
    """Prints "@@progress done total" at most twice a second, and a line for people every few seconds.

    `bar` says where AI Write's bar is for what has come so far, for a step with more than one part
    (Parakeet: downloading, then unpacking); by default the bar is just this part.
    """

    def __init__(self, what: str, total: int, bar=None) -> None:
        self.what, self.total = what, total
        self.bar = bar or (lambda done, total: (done, total))
        self.last = 0.0
        self.last_human = 0.0

    def __call__(self, done: int, force: bool = False) -> None:
        now = time.time()
        if not force and now - self.last < 0.5:
            return
        self.last = now
        at, of = self.bar(done, self.total)
        say(f"@@progress {at} {of}")
        if force or now - self.last_human >= 4:
            self.last_human = now
            if self.total:
                say(f"{self.what}: {min(100, done * 100 // self.total)}% ({mb(done)} of {mb(self.total)})")
            else:
                say(f"{self.what}: {mb(done)}")


def mb(n: int) -> str:
    return f"{n / 1e9:.1f} GB" if n >= 1e9 else f"{n / 1e6:.0f} MB"


def fetch(url: str, dest: Path, what: str, bar=None) -> None:
    """Downloads `url` to `dest` with progress, through a .part file, so a stopped download leaves nothing half-made."""
    part = dest.with_name(dest.name + ".part")
    with urllib.request.urlopen(url, timeout=60) as r:
        total = int(r.headers.get("Content-Length") or 0)
        progress = Progress(what, total, bar)
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


def run_with_progress(work, root, what: str, total: int) -> None:
    """Runs `work()` on a thread while reporting how much has arrived under `root` (a folder, or a list of them)."""
    roots = list(root) if isinstance(root, (list, tuple)) else [root]

    def arrived() -> int:
        return sum(folder_bytes(r) for r in roots if r.exists())

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
        progress(arrived())
    progress(total or arrived(), force=True)
    if errors:
        raise errors[0]


# --- the server ------------------------------------------------------------


def check_server() -> int:
    missing = [m for m in ("fastapi", "uvicorn", "soundfile", "numpy") if not can_import(sys.executable, m)]
    if missing:
        say(f"Missing: {', '.join(missing)}")
        # AI Write sets the environment up afresh on Try again after this step fails.
        return fail("Part of the speech engine didn’t install. Try again to set it up afresh; the voices are kept.")
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


def module_version(module: str) -> str:
    """`module`'s version without its build tag, as installed here, or ""."""
    try:
        out = subprocess.run(
            [sys.executable, "-c", f"import {module}; print({module}.__version__.split('+')[0])"],
            capture_output=True, text=True, timeout=300,
        )
    except (OSError, subprocess.SubprocessError):
        return ""
    return out.stdout.strip().splitlines()[-1].strip() if out.returncode == 0 and out.stdout.strip() else ""


def torch_in_place(pins: list[str], what: str) -> int:
    """Makes sure PyTorch (and torchvision, when pinned with it) is the pinned CUDA build: another package may have
    pulled in the plain one. `what` names the engine in plain words, if it has to say it failed."""
    version, cuda = torch_state()
    want = pins[0].split("==", 1)[1]
    others = [pin.split("==", 1) for pin in pins[1:] if pin.startswith("torchvision==")]
    if version == want and cuda and all(module_version(name) == wanted for name, wanted in others):
        say("The graphics card part is in place.")
        return 0
    say("Putting the graphics card part back in place (about 3 GB)…")
    code = subprocess.call([
        sys.executable, "-m", "pip", "install", "--no-input", "--disable-pip-version-check", "--progress-bar", "raw",
        "--force-reinstall", "--no-deps", *pins, "--index-url", TORCH_INDEX,
    ])
    if code:
        return fail(f"{what}’s graphics card part didn’t download. Check the internet connection, then Try again.")
    return 0


def breeze_torch() -> int:
    return torch_in_place(TORCH, "The voice engine")


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
        return fail("Breeze’s code didn’t download. Check the internet connection, then Try again.")
    finally:
        archive.unlink(missing_ok=True)
    say("Breeze's code is in place.")
    return 0


def refused(exc: BaseException, key: bool) -> str:
    """Why Hugging Face said no: "licence" (its licence has to be accepted first), "key" (it turned the saved
    key down: mistyped, revoked, or without read access), or "" (something else). `key`: a key was given."""
    name = exc.__class__.__name__
    text = f"{name} {exc}"
    status = getattr(getattr(exc, "response", None), "status_code", None)
    if "GatedRepo" in name:
        return "licence"
    if key and (status == 401 or re.search(r"\b401\b|Unauthorized|Invalid credentials|Invalid user token", text)):
        return "key"
    if status in (401, 403) or re.search(r"\b40[13]\b|gated|Unauthorized|Forbidden", text):
        return "licence"
    return ""


def tell_refused(why: str, page: str) -> int:
    if why == "key":
        say("@@key")
        return fail("Hugging Face didn’t accept the saved key. Make a new key with read access, save it, then Try again.", 3)
    say(f"@@licence {page}")
    return 3


def breeze_weights(root: Path) -> int:
    """Pull the weights now, so the first sentence read does not (the server never downloads)."""
    from huggingface_hub import HfApi, snapshot_download

    page = f"https://huggingface.co/{BREEZE_REPO}"
    token = os.environ.get("HF_TOKEN") or None
    # The weights may change from here on: they count as downloaded again only once checked (breeze-check).
    downloaded.breeze_mark(root).unlink(missing_ok=True)
    say(f"Downloading Breeze TTS 2's voices from {page}")
    try:
        info = HfApi().model_info(BREEZE_REPO, files_metadata=True, token=token)
        total = sum(
            (s.size or 0) for s in (info.siblings or [])
            if not any(Path(s.rfilename).match(p) for p in BREEZE_IGNORE)
        )
    except Exception as exc:  # noqa: BLE001
        why = refused(exc, bool(token))
        if why:
            return tell_refused(why, page)
        say(f"Could not reach Hugging Face: {exc.__class__.__name__}")
        return fail("Couldn’t reach Hugging Face to download the voices. Check the internet connection, then Try again.")
    cache = Path(os.environ.get("HF_HOME") or root / "models" / "hf") / "hub" / downloaded.hub_folder(BREEZE_REPO)
    try:
        run_with_progress(
            # One file at a time, so a stop leaves one partial file, picked up again by Try again.
            lambda: snapshot_download(BREEZE_REPO, ignore_patterns=BREEZE_IGNORE, max_workers=1, token=token),
            cache,
            "Downloading the voices",
            total,
        )
    except Exception as exc:  # noqa: BLE001
        why = refused(exc, bool(token))
        if why:
            return tell_refused(why, page)
        say(f"The download stopped: {exc.__class__.__name__}")
        return fail("The voices didn’t finish downloading. Check the internet connection and that there’s about 12 GB free, then Try again.")
    say("The voices are downloaded.")
    return 0


def breeze_check(root: Path) -> int:
    """Checks the voices' environment and weights; only then leaves the mark that says they are downloaded."""
    mark = downloaded.breeze_mark(root)
    mark.unlink(missing_ok=True)
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
        # AI Write sets the voices' environment up afresh on Try again after this step fails.
        return fail("Part of the voice engine didn’t install. Try again to set it up afresh; the voices already downloaded are kept.")
    # This step only runs after the weights' own step finished in the same download.
    snapshot = downloaded.snapshot_dir(downloaded.breeze_weights_dir(root), ("config.json",))
    if snapshot is None:
        say("@@keep-environment")
        return fail("The voices didn’t finish downloading. Try again; what is already downloaded is kept.")
    mark.parent.mkdir(parents=True, exist_ok=True)
    mark.write_text(f"{snapshot.name}\n", encoding="utf-8")
    say("The voices are ready." if card else "The voices are installed, but no NVIDIA graphics card is visible, so they would be far too slow.")
    return 0


# --- the sound effects ------------------------------------------------------


def repo_bytes(repo: str, keep, token, revision: str | None = None) -> int:
    """How much the files of `repo` (at `revision`) that `keep(name)` picks add up to."""
    from huggingface_hub import HfApi

    info = HfApi().model_info(repo, revision=revision, files_metadata=True, token=token)
    return sum((s.size or 0) for s in (info.siblings or []) if keep(s.rfilename))


def sound_part(name: str) -> bool:
    """One of the files diffusers loads (downloaded.SOUND_PATTERNS), not the original checkpoints beside them."""
    return any(name == p or (p.endswith("/*") and name.startswith(p[:-1])) for p in downloaded.SOUND_PATTERNS)


def clap_part(weights: str):
    names = set(downloaded.CLAP_FILES) | {weights}
    return lambda name: name in names


def sound_weights(root: Path) -> int:
    """Stable Audio Open (only what diffusers loads) and CLAP, so the first sound made downloads nothing."""
    from huggingface_hub import snapshot_download

    page = f"https://huggingface.co/{SOUND_REPO}"
    token = os.environ.get("HF_TOKEN") or None
    # They may change from here on: they count as downloaded again only once checked (sound-check).
    downloaded.sound_mark(root).unlink(missing_ok=True)
    say(f"Downloading Stable Audio Open from {page}")
    clap = {"revision": CLAP_REVISION, "weights": "model.safetensors"}
    try:
        total = repo_bytes(SOUND_REPO, sound_part, token)
    except Exception as exc:  # noqa: BLE001
        why = refused(exc, bool(token))
        if why:
            return tell_refused(why, page)
        say(f"Could not reach Hugging Face: {exc.__class__.__name__}")
        return fail("Couldn’t reach Hugging Face to download the sound effects. Check the internet connection, then Try again.")
    try:
        # CLAP is public: it is fetched without the key, so a key Hugging Face turns down never stops it.
        total += repo_bytes(CLAP_REPO, clap_part(clap["weights"]), False, clap["revision"])
    except Exception as exc:  # noqa: BLE001
        say(f"CLAP's converted copy isn't there ({exc.__class__.__name__}); using its original one.")
        clap = {"revision": None, "weights": "pytorch_model.bin"}
        try:
            total += repo_bytes(CLAP_REPO, clap_part(clap["weights"]), False)
        except Exception as again:  # noqa: BLE001
            say(f"Could not reach Hugging Face: {again.__class__.__name__}")
            return fail("Couldn’t reach Hugging Face to download the sound effects. Check the internet connection, then Try again.")

    def work() -> None:
        # One file at a time, so a stop leaves one partial file, picked up again by Try again.
        snapshot_download(SOUND_REPO, allow_patterns=list(downloaded.SOUND_PATTERNS), max_workers=1, token=token)
        say("Downloading CLAP, which picks the best of each sound's takes")
        snapshot_download(
            CLAP_REPO, revision=clap["revision"], allow_patterns=[*downloaded.CLAP_FILES, clap["weights"]],
            max_workers=1, token=False,
        )

    hub = Path(os.environ.get("HF_HOME") or root / "models" / "hf") / "hub"
    try:
        run_with_progress(
            work,
            [hub / downloaded.hub_folder(SOUND_REPO), hub / downloaded.hub_folder(CLAP_REPO)],
            "Downloading the sound effects",
            total,
        )
    except Exception as exc:  # noqa: BLE001
        why = refused(exc, bool(token))
        if why:
            return tell_refused(why, page)
        say(f"The download stopped: {exc.__class__.__name__}")
        return fail("The sound effects didn’t finish downloading. Check the internet connection and that there’s about 12 GB free, then Try again.")
    if downloaded.sound_dir(root) is None or downloaded.clap_dir(root) is None:
        # Said here, by the download itself, rather than by the check (which would set the environment up afresh).
        return fail("The sound effects didn’t finish downloading. Try again; what is already downloaded is kept.")
    say("The sound effects are downloaded.")
    return 0


def sound_check(root: Path) -> int:
    """Checks the sound effects' environment and models; only then leaves the mark that says they are downloaded."""
    mark = downloaded.sound_mark(root)
    mark.unlink(missing_ok=True)
    say("Checking the sound effects…")
    failures = [m for m in SOUND_MODULES if not can_import(sys.executable, m)]
    for module in SOUND_MODULES:
        say(f"  {module}: {'missing' if module in failures else 'ok'}")
    if not failures and subprocess.call([sys.executable, "-c", SOUND_IMPORTS], stdout=subprocess.DEVNULL) != 0:
        say("  Stable Audio Open's pipeline or CLAP: missing")
        failures.append("diffusers")
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
        # AI Write sets the sound effects' environment up afresh on Try again after this step fails.
        return fail("Part of the sound effects didn’t install. Try again to set it up afresh; what is already downloaded is kept.")
    sound, clap = downloaded.sound_dir(root), downloaded.clap_dir(root)
    if sound is None or clap is None:
        # The environment checked out: only the files are missing.
        say("@@keep-environment")
        return fail("The sound effects didn’t finish downloading. Try again; what is already downloaded is kept.")
    mark.parent.mkdir(parents=True, exist_ok=True)
    mark.write_text(f"{sound.name}\n{clap.name}\n", encoding="utf-8")
    say("The sound effects are ready." if card else "The sound effects are installed, but no NVIDIA graphics card is visible, so each would take minutes to make.")
    return 0


# --- dictation ------------------------------------------------------------


class _Reading:
    """A file read from start to end, telling `progress` how much has been read."""

    def __init__(self, f, progress: Progress) -> None:
        self.f, self.progress, self.done = f, progress, 0

    def read(self, n: int = -1) -> bytes:
        data = self.f.read(n)
        self.done += len(data)
        self.progress(self.done)
        return data


def unpack_parakeet(archive: Path, dest: Path) -> Path:
    """Unpacks Parakeet's archive beside `dest` (in .unpack) and moves its folder into place only once all of its
    files are there, so a stop part way never leaves files that read as downloaded. Returns where it went."""
    aside = dest / downloaded.UNPACKING
    shutil.rmtree(aside, ignore_errors=True)
    aside.mkdir(parents=True)
    try:
        size = archive.stat().st_size
        # The step's bar: downloading is its first four fifths, unpacking the last.
        progress = Progress("Unpacking Parakeet", size, lambda done, total: (total * 4 + done, total * 5))
        with open(archive, "rb") as f, tarfile.open(fileobj=_Reading(f, progress), mode="r|bz2") as packed:
            try:
                packed.extractall(aside, filter="data")
            except TypeError:  # Python before 3.10.12 has no filter
                packed.extractall(aside)
        progress(size, force=True)
        found = downloaded.parakeet_dir(aside)
        if found is None:
            raise tarfile.TarError("Parakeet's files weren't all in its archive")
        target = dest / (found.name if found != aside else "model")
        shutil.rmtree(target, ignore_errors=True)
        found.replace(target)
        return target
    finally:
        shutil.rmtree(aside, ignore_errors=True)


def parakeet_model(home: Path) -> int:
    dest = home / "models" / "parakeet"
    dest.mkdir(parents=True, exist_ok=True)
    if downloaded.parakeet_dir(dest) is not None:
        say("Parakeet is already downloaded.")
        return 0
    archive = dest / "parakeet.tar.bz2"
    try:
        # A whole archive left by a stop while unpacking is unpacked again rather than fetched again.
        if not archive.is_file():
            say("Downloading Parakeet (about half a gigabyte to download, once)…")
            fetch(PARAKEET_URL, archive, "Downloading Parakeet", lambda done, total: (done * 4, total * 5))
        say("Unpacking…")
        unpack_parakeet(archive, dest)
    except (OSError, tarfile.TarError, EOFError) as exc:
        say(f"Could not download it: {exc}")
        return fail("Parakeet didn’t download. Check the internet connection, then Try again.")
    finally:
        archive.unlink(missing_ok=True)
    say("Parakeet is ready.")
    return 0


def whisper_model(home: Path) -> int:
    from huggingface_hub import HfApi, snapshot_download

    root = home / "models" / "whisper"
    root.mkdir(parents=True, exist_ok=True)
    cache = root / downloaded.hub_folder(WHISPER_REPO)
    say("Downloading Whisper's English model…")
    try:
        info = HfApi().model_info(WHISPER_REPO, files_metadata=True)
        total = sum((s.size or 0) for s in (info.siblings or []) if not s.rfilename.endswith(".md"))
        # The same place and layout faster-whisper looks in (WhisperModel's download_root).
        run_with_progress(lambda: snapshot_download(WHISPER_REPO, cache_dir=str(root), max_workers=1), cache, "Downloading Whisper", total)
    except Exception as exc:  # noqa: BLE001
        say(f"The download stopped: {exc.__class__.__name__}")
        return fail("Whisper didn’t download. Check the internet connection, then Try again.")
    if downloaded.whisper_dir(root) is None:
        return fail("Whisper downloaded, but its model wasn’t all there. Try again.")
    say("Whisper is ready.")
    return 0


# --- the studio voices ------------------------------------------------------
# Adapted from mcreader-v2, tts/tools/studio_library.py and tts/tools/voice_lab.py (RangeFile, the EARS addresses).
#
# Breeze copies every line from a voice's clip, its microphone and room included, and a voice it designs from a
# description can come out tinny or echoey. These are clean by construction: each native English speaker of the EARS
# dataset (https://github.com/facebookresearch/ears_dataset, CC BY-NC 4.0: personal use) reading the Rainbow Passage,
# recorded in an anechoic studio at 48 kHz, saved at 24 kHz under voices/library/ with the words beside each, and
# their acted clips of the feelings reading aloud uses (voices/library/<id>/<emotion>.wav, MOOD_CLIPS in
# app/workers/breeze.py), whispering and reading loudly. Only those clips are read out of each speaker's zip (HTTP
# range requests), not the whole 590 MB. Always fetched from the dataset itself, never copied from another app.

EARS = "https://github.com/facebookresearch/ears_dataset"
EARS_ZIP = EARS + "/releases/download/dataset/{}.zip"
EARS_RAW = "https://raw.githubusercontent.com/facebookresearch/ears_dataset/main/{}"
EARS_PARTS = ["rainbow_01_regular", "rainbow_02_regular"]
# The acted feelings MOOD_CLIPS reads from (the worker's names for them are the dataset's), and the two ways of speaking.
EARS_EMOTIONS = ["adoration", "amazement", "amusement", "anger", "contentment", "disappointment", "disgust", "distress", "fear", "sadness"]
EARS_STYLES = ["whisper", "loud"]
# About how much of a speaker's zip is fetched (p002: 31 MB), for the progress bar until each one is opened.
EARS_VOICE_BYTES = 31_000_000
# Every clip is saved at this peak, like a designed voice (DESIGN_PEAK in the worker): each line copied from it follows it.
CLIP_PEAK = 0.6

# Names for the voices, so a cast list reads "Clara" rather than "p058". Given in order of speaker id, each once; a
# voice keeps its name once given (it's saved in index.json). MCreader's lists, so a voice has the same name in both.
WOMEN = [
    "Clara", "Maya", "Iris", "Nora", "Ruth", "Elsie", "Hazel", "June", "Freya", "Mabel", "Alice", "Esme", "Lena", "Tessa",
    "Greta", "Vera", "Ada", "Rosa", "Edith", "Ivy", "Lucy", "Mae", "Nell", "Opal", "Pearl", "Rhea", "Sadie", "Thea",
    "Una", "Wren", "Zara", "Bea", "Cora", "Dora", "Eve", "Faye", "Gwen", "Hope", "Isla", "Jade", "Kate", "Lila", "Mira",
    "Nina", "Olive", "Paige", "Quinn", "Rosie", "Stella", "Tara", "Uma", "Viola", "Willa", "Yara", "Zoe", "Anya", "Bonnie",
    "Celia", "Daisy", "Ella", "Flora", "Grace", "Holly", "Ingrid", "Joy", "Kira", "Laurel", "Molly", "Naomi", "Ottilie",
]
MEN = [
    "Arthur", "Ben", "Cole", "Dan", "Eli", "Felix", "Gabe", "Hugh", "Ian", "Jack", "Kit", "Leo", "Miles", "Ned", "Owen",
    "Paul", "Ralph", "Sam", "Tom", "Vic", "Walt", "Abe", "Bram", "Carl", "Dev", "Ezra", "Finn", "Grant", "Hal", "Ivan",
    "Joel", "Karl", "Luke", "Max", "Nate", "Otto", "Pete", "Reid", "Saul", "Theo", "Vince", "Will", "Zeke", "Alan", "Boris",
]


class RangeFile(io.RawIOBase):
    """A remote file read with HTTP Range requests, so zipfile can take single members out of a large zip."""

    def __init__(self, url: str, counted=None):
        with urllib.request.urlopen(urllib.request.Request(url, method="HEAD"), timeout=60) as r:
            self.url, self.size = r.geturl(), int(r.headers["Content-Length"])
        self.pos = 0
        self.counted = counted or (lambda n: None)

    def seekable(self):
        return True

    def readable(self):
        return True

    def tell(self):
        return self.pos

    def seek(self, off, whence=0):
        self.pos = off if whence == 0 else self.pos + off if whence == 1 else self.size + off
        return self.pos

    def readinto(self, b):
        n = min(len(b), self.size - self.pos)
        if n <= 0:
            return 0
        req = urllib.request.Request(self.url, headers={"Range": f"bytes={self.pos}-{self.pos + n - 1}"})
        with urllib.request.urlopen(req, timeout=60) as r:
            data = r.read()
        b[: len(data)] = data
        self.pos += len(data)
        self.counted(len(data))
        return len(data)


def _clip(pieces, librosa, np):
    """Clips (audio, sr) trimmed of silence, at 24 kHz, joined with a short gap, at CLIP_PEAK."""
    out = []
    for x, sr in pieces:
        x, _ = librosa.effects.trim(x.mean(1) if x.ndim > 1 else x, top_db=40)
        out += [librosa.resample(x, orig_sr=sr, target_sr=24000), np.zeros(int(0.35 * 24000), np.float32)]
    y = np.concatenate(out[:-1]).astype(np.float32)
    return y * (CLIP_PEAK / max(1e-6, float(abs(y).max())))


def _save(path: Path, audio, words: str, sf) -> None:
    """A clip and its words, each written beside and renamed into place, the clip last: a half-written clip is never a voice."""
    part = path.with_name(path.name + ".part")
    part.write_text(words, encoding="utf-8")
    os.replace(part, path.with_suffix(".txt"))
    sf.write(str(part), audio, 24000, format="WAV", subtype="PCM_16")
    os.replace(part, path)


def _voice_done(out: Path, p: str) -> bool:
    folder = out / p
    return (out / f"{p}.wav").is_file() and all((folder / f"{m}.wav").is_file() for m in EARS_EMOTIONS + EARS_STYLES)


def name_voices(index: dict) -> None:
    """Gives every voice without one a first name for its gender, none used twice."""
    used = {v["name"] for v in index.values() if v.get("name")}
    for v in sorted(index.values(), key=lambda v: v["id"]):
        if v.get("name"):
            continue
        pool = WOMEN if v["gender"] == "female" else MEN
        v["name"] = next((n for n in pool if n not in used), v["id"])
        used.add(v["name"])


def classify_pitch(index: dict) -> None:
    """Pitch for their gender, across the whole library: the lowest third low, the highest third high."""
    for gender in ("male", "female"):
        hz = sorted(v["hz"] for v in index.values() if v["gender"] == gender and v.get("hz"))
        if not hz:
            continue
        low, high = hz[len(hz) // 3], hz[2 * len(hz) // 3]
        for v in index.values():
            if v["gender"] == gender:
                v["pitch"] = "low" if v.get("hz") and v["hz"] < low else "high" if v.get("hz", 0) > high else "mid"


def studio_voices(root: Path) -> int:
    """Every native English EARS speaker's calm clip and acted clips into voices/library/, with index.json."""
    import json

    import librosa
    import numpy as np
    import soundfile as sf

    out = downloaded.studio_dir(root)
    out.mkdir(parents=True, exist_ok=True)
    # They may change from here on: they count as downloaded again only once checked (studio-check).
    downloaded.studio_mark(root).unlink(missing_ok=True)
    say(f"Looking up the studio voices at {EARS}")
    try:
        speakers = json.loads(urllib.request.urlopen(EARS_RAW.format("speaker_statistics.json"), timeout=60).read())
        words = json.loads(urllib.request.urlopen(EARS_RAW.format("transcripts.json"), timeout=60).read())
    except Exception as exc:  # noqa: BLE001
        say(f"Could not reach the dataset: {exc.__class__.__name__}")
        return fail("Couldn’t reach the studio voices to download them. Check the internet connection, then Try again.")
    calm = " ".join(words[part] for part in EARS_PARTS)
    index_file = out / "index.json"
    try:
        index = {v["id"]: v for v in json.loads(index_file.read_text(encoding="utf-8"))} if index_file.is_file() else {}
    except (OSError, ValueError, KeyError, TypeError):
        index = {}
    wanted = sorted(p for p, s in speakers.items() if "english" in s["native language"].lower() and s["gender"] in ("male", "female"))
    todo = [p for p in wanted if not (p in index and _voice_done(out, p))]
    say(f"{len(wanted)} studio voices, {len(wanted) - len(todo)} already here.")
    got = [0]
    total = [EARS_VOICE_BYTES * len(todo)]
    progress = Progress("Downloading the studio voices", total[0])

    def counted(n: int) -> None:
        got[0] += n
        progress.total = max(total[0], got[0])
        progress(got[0])

    missed = 0
    for n, p in enumerate(todo, 1):
        try:
            z = zipfile.ZipFile(io.BufferedReader(RangeFile(EARS_ZIP.format(p), counted), buffer_size=1 << 16))
            members = {i.filename: i for i in z.infolist()}
            names = [f"{p}/{m}.wav" for m in EARS_PARTS + [f"emo_{e}_sentences" for e in EARS_EMOTIONS] + [f"rainbow_0{k}_{s}" for s in EARS_STYLES for k in (1, 2)]]
            # The estimate for this speaker, swapped for what its zip says it holds.
            total[0] += sum(members[m].compress_size for m in names if m in members) - EARS_VOICE_BYTES

            def read(member: str):
                return sf.read(io.BytesIO(z.read(f"{p}/{member}.wav")), dtype="float32")

            y = _clip([read(part) for part in EARS_PARTS], librosa, np)
            f0 = librosa.yin(y, fmin=60, fmax=400, sr=24000)
            voiced = f0[(f0 > 60) & (f0 < 400)]
            hz = float(np.median(voiced)) if voiced.size else 0.0
            folder = out / p
            folder.mkdir(exist_ok=True)
            moods = []
            for emotion in EARS_EMOTIONS:
                key = f"emo_{emotion}_sentences"
                if f"{p}/{key}.wav" in members and key in words:
                    _save(folder / f"{emotion}.wav", _clip([read(key)], librosa, np), words[key], sf)
                    moods.append(emotion)
            for style in EARS_STYLES:
                parts = [f"rainbow_0{k}_{style}" for k in (1, 2)]
                if all(f"{p}/{m}.wav" in members and m in words for m in parts):
                    _save(folder / f"{style}.wav", _clip([read(m) for m in parts], librosa, np), " ".join(words[m] for m in parts), sf)
                    moods.append(style)
            # The calm clip last: a voice is listed only once it is there.
            _save(out / f"{p}.wav", y, calm, sf)
        except Exception as exc:  # noqa: BLE001 - one speaker missing is no reason to stop
            missed += 1
            say(f"{p}: skipped ({exc.__class__.__name__})")
            continue
        s = speakers[p]
        index[p] = {**index.get(p, {}), "id": p, "gender": s["gender"], "age": s["age"], "hz": round(hz), "moods": moods}
        say(f"{n}/{len(todo)} {p}: {s['gender']} {s['age']}, {hz:.0f} Hz, {len(moods)} feelings")
        index_file.write_text(json.dumps(sorted(index.values(), key=lambda v: v["id"]), indent=1), encoding="utf-8")
    progress(got[0], force=True)
    name_voices(index)
    classify_pitch(index)
    index_file.write_text(json.dumps(sorted(index.values(), key=lambda v: v["id"]), indent=1), encoding="utf-8")
    if missed and missed * 4 > len(wanted):
        return fail("Some of the studio voices didn’t download. Check the internet connection, then Try again; those already here are kept.")
    say(f"{len(index)} studio voices in {out}")
    return 0


def check_model(root: Path) -> int:
    """The word check's listener (distil-whisper's small English model) into Breeze's Hugging Face cache."""
    from huggingface_hub import HfApi, snapshot_download

    repo = downloaded.CHECK_REPO
    files = list(downloaded.CHECK_FILES)
    say(f"Downloading the word check from https://huggingface.co/{repo}")
    try:
        info = HfApi().model_info(repo, files_metadata=True, token=False)
        total = sum((s.size or 0) for s in (info.siblings or []) if s.rfilename in files)
        hub = Path(os.environ.get("HF_HOME") or root / "models" / "hf") / "hub"
        run_with_progress(
            lambda: snapshot_download(repo, allow_patterns=files, max_workers=1, token=False),
            hub / downloaded.hub_folder(repo),
            "Downloading the word check",
            total,
        )
    except Exception as exc:  # noqa: BLE001
        say(f"The download stopped: {exc.__class__.__name__}")
        return fail("The word check didn’t download. Check the internet connection, then Try again.")
    if downloaded.check_dir(root) is None:
        return fail("The word check downloaded, but it wasn’t all there. Try again.")
    say("The word check is downloaded.")
    return 0


def studio_check(root: Path) -> int:
    """Checks the studio voices and the word check; only then leaves the mark that says they are downloaded."""
    import json

    mark = downloaded.studio_mark(root)
    mark.unlink(missing_ok=True)
    say("Checking the studio voices…")
    out = downloaded.studio_dir(root)
    try:
        listed = json.loads((out / "index.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        listed = []
    voices = [v for v in listed if isinstance(v, dict) and (out / f"{v.get('id')}.wav").is_file() and (out / f"{v.get('id')}.txt").is_file()]
    if not voices:
        return fail("The studio voices didn’t download. Try again.")
    if downloaded.check_dir(root) is None:
        return fail("The word check didn’t finish downloading. Try again; the studio voices are kept.")
    mark.write_text(str(len(voices)), encoding="utf-8")
    say(f"{len(voices)} studio voices are ready.")
    return 0


def check_dictation(engine: str) -> int:
    module = "sherpa_onnx" if engine == "parakeet" else "faster_whisper"
    if not can_import(sys.executable, module):
        return fail(f"{engine.capitalize()} didn’t install. Try again.")
    say(f"{engine.capitalize()} is installed.")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="AI Write's speech downloads.")
    parser.add_argument("step", choices=[
        "check-server", "breeze-torch", "breeze-code", "breeze-weights", "breeze-check",
        "sound-torch", "sound-weights", "sound-check",
        "studio-voices", "check-model", "studio-check",
        "parakeet-model", "whisper-model", "check-dictation",
    ])
    parser.add_argument("engine", nargs="?", choices=["parakeet", "whisper"])
    parser.add_argument("--root", help="Where Breeze's (or the sound effects') environment, code and weights go.")
    parser.add_argument("--home", help="AI Write's speech folder.")
    args = parser.parse_args()
    root = Path(args.root) if args.root else None
    home = Path(args.home) if args.home else None

    if args.step in ("breeze-code", "breeze-weights", "breeze-check", "sound-weights", "sound-check", "studio-voices", "check-model", "studio-check") and root is None:
        parser.error(f"{args.step} needs --root")
    if args.step in ("parakeet-model", "whisper-model") and home is None:
        parser.error(f"{args.step} needs --home")

    if args.step == "check-server":
        return check_server()
    if args.step == "breeze-torch":
        return breeze_torch()
    if args.step == "breeze-code":
        return breeze_code(root)
    if args.step == "breeze-weights":
        return breeze_weights(root)
    if args.step == "breeze-check":
        return breeze_check(root)
    if args.step == "sound-torch":
        return torch_in_place(SOUND_TORCH, "The sound effects")
    if args.step == "sound-weights":
        return sound_weights(root)
    if args.step == "sound-check":
        return sound_check(root)
    if args.step == "studio-voices":
        return studio_voices(root)
    if args.step == "check-model":
        return check_model(root)
    if args.step == "studio-check":
        return studio_check(root)
    if args.step == "parakeet-model":
        return parakeet_model(home)
    if args.step == "whisper-model":
        return whisper_model(home)
    return check_dictation(args.engine or "parakeet")


if __name__ == "__main__":
    raise SystemExit(main())
