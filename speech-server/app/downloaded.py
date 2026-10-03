"""What counts as downloaded: the checks the download steps (tools/install.py) and the server share.

A download that was stopped part way must never read as done, or the server would offer a model it
can't load. So:

* Breeze counts once the voices' last download step has checked it and left a mark
  (models/breeze/.ready). AI Write removes the mark whenever the voices start downloading again. Only
  AI Write's own copy, in its speech folder, is ever used.
* Parakeet counts when all four of its files are in one folder (it is unpacked aside, then moved into
  place); Whisper when all of its files are in one snapshot.

AI Write's main process makes the same checks (src/main/speech/installed.ts). Standard library only:
the download steps run this before anything else is installed.
"""

from pathlib import Path

BREEZE_REPO = "BreezeBlue/breeze-tts-2"

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


def breeze_complete(root: Path) -> bool:
    """Breeze's weights at `root` can be loaded: the voices' last download step left its mark."""
    return breeze_mark(root).is_file() and snapshot_dir(breeze_weights_dir(root), ("config.json",)) is not None


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
