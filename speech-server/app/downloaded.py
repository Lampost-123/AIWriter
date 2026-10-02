"""What counts as downloaded: the checks the download steps (tools/install.py) and the server share.

A download that was stopped part way must never read as done, or the server would offer a model it
can't load. So:

* AI Write's own copy of Breeze counts once the voices' last download step has checked it and left a
  mark (models/breeze/.ready). AI Write removes the mark whenever the voices start downloading again.
* MCreader v2's copy, which has no mark, counts when its weights look whole: every file its index
  names, and what speaking needs besides, is in the snapshot the server loads, and nothing is left
  half-downloaded.
* Parakeet counts when all four of its files are in one folder (it is unpacked aside, then moved into
  place); Whisper when all of its files are in one snapshot.

AI Write's main process makes the same checks (src/main/speech/installed.ts). Standard library only:
the download steps run this before anything else is installed.
"""

import json
import os
from pathlib import Path

BREEZE_REPO = "BreezeBlue/breeze-tts-2"
# Besides the shards the weights' index names: what Breeze reads to speak (its tokenizer and the audio codec).
BREEZE_NEEDS = ("config.json", "tokenizer.json", "tokenizer_config.json", "audio_tokenizer/model.safetensors")
BREEZE_INDEX = "model.safetensors.index.json"

PARAKEET_FILES = ("encoder.int8.onnx", "decoder.int8.onnx", "joiner.int8.onnx", "tokens.txt")
# Where Parakeet's archive is unpacked before it is moved into place; never counted as downloaded.
UNPACKING = ".unpack"

WHISPER_REPO = "Systran/faster-whisper-base.en"
WHISPER_FILES = ("config.json", "model.bin", "tokenizer.json", "vocabulary.txt")


def hub_folder(repo: str) -> str:
    """The folder Hugging Face's cache keeps `repo` in."""
    return "models--" + repo.replace("/", "--")


def breeze_weights_dir(root: Path) -> Path:
    return Path(root) / "models" / "hf" / "hub" / hub_folder(BREEZE_REPO)


def breeze_mark(root: Path) -> Path:
    """Left by the voices' last download step once everything checked out."""
    return Path(root) / "models" / "breeze" / ".ready"


def _half_downloaded(weights: Path) -> bool:
    """A file Hugging Face is still fetching (or was, when it was stopped) is kept as blobs/<id>.incomplete."""
    try:
        return any(p.name.endswith(".incomplete") for p in (weights / "blobs").iterdir())
    except OSError:
        return False


def snapshot_dir(weights: Path, needs: tuple[str, ...]) -> Path | None:
    """The snapshot the server loads (the one refs/main names, else any) when it has every file in `needs`."""
    snapshots = weights / "snapshots"
    try:
        ref = (weights / "refs" / "main").read_text(encoding="utf-8").strip()
    except OSError:
        ref = ""
    try:
        names = [ref] if ref and (snapshots / ref).is_dir() else sorted(p.name for p in snapshots.iterdir() if p.is_dir())
    except OSError:
        return None
    for name in names:
        folder = snapshots / name
        if all((folder / f).is_file() for f in needs):
            return folder
    return None


def _shards_whole(snapshot: Path) -> bool:
    """Every shard the weights' index names is there."""
    try:
        names = set(json.loads((snapshot / BREEZE_INDEX).read_text(encoding="utf-8"))["weight_map"].values())
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        return False
    return bool(names) and all((snapshot / str(n)).is_file() for n in names)


def breeze_weights_whole(root: Path) -> bool:
    """Breeze's weights at `root` look complete (for a copy without AI Write's mark)."""
    weights = breeze_weights_dir(root)
    if _half_downloaded(weights):
        return False
    snapshot = snapshot_dir(weights, BREEZE_NEEDS + (BREEZE_INDEX,))
    return snapshot is not None and _shards_whole(snapshot)


def breeze_complete(root: Path, own: bool) -> bool:
    """Breeze's weights at `root` can be loaded: AI Write's own copy (`own`) by its mark, MCreader's by its files."""
    if own:
        return breeze_mark(root).is_file() and snapshot_dir(breeze_weights_dir(root), ("config.json",)) is not None
    return breeze_weights_whole(root)


def same_folder(a: Path, b: Path) -> bool:
    return os.path.normcase(os.path.abspath(a)) == os.path.normcase(os.path.abspath(b))


def parakeet_dir(root: Path) -> Path | None:
    """The folder holding all of Parakeet's files: `root` itself, or one folder down as its archive unpacks."""
    root = Path(root)
    try:
        folders = [root] + sorted(p for p in root.iterdir() if p.is_dir() and p.name != UNPACKING)
    except OSError:
        return None
    for folder in folders:
        if all((folder / f).is_file() for f in PARAKEET_FILES):
            return folder
    return None


def whisper_dir(root: Path) -> Path | None:
    """Whisper's English model in its Hugging Face cache under `root` (where faster-whisper looks), when it is all there."""
    weights = Path(root) / hub_folder(WHISPER_REPO)
    if _half_downloaded(weights):
        return None
    return snapshot_dir(weights, WHISPER_FILES)
