"""What counts as downloaded: the checks the download steps (tools/install.py) and the server share.

A download that was stopped part way must never read as done, or the server would offer a model it
can't load. So:

* Breeze counts once the voices' last download step has checked it and left a mark
  (models/breeze/.ready). AI Write removes the mark whenever the voices start downloading again. Only
  AI Write's own copy, in its speech folder, is ever used.
* Parakeet counts when all four of its files are in one folder (it is unpacked aside, then moved into
  place); Whisper when all of its files are in one snapshot.
* The sound effects (Stable Audio Open, ranked by CLAP) count the way Breeze does: once their last download
  step has checked them and left a mark (models/sound/.ready), with both models' files in place.

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

# The sound effects: Stable Audio Open makes them, CLAP picks the best of a few takes.
SOUND_REPO = "stabilityai/stable-audio-open-1.0"
# Only the parts diffusers loads (about 5.3 GB), not the original checkpoints beside them.
SOUND_PATTERNS = (
    "model_index.json", "transformer/*", "vae/*", "text_encoder/*", "tokenizer/*", "projection_model/*", "scheduler/*",
)
SOUND_FILES = (
    "model_index.json",
    "transformer/config.json", "transformer/diffusion_pytorch_model.safetensors",
    "vae/config.json", "vae/diffusion_pytorch_model.safetensors",
    "text_encoder/config.json", "text_encoder/model.safetensors",
    "tokenizer/tokenizer_config.json", "tokenizer/spiece.model",
    "projection_model/config.json", "projection_model/diffusion_pytorch_model.safetensors",
    "scheduler/scheduler_config.json",
)
CLAP_REPO = "laion/larger_clap_general"
# What ClapModel and ClapProcessor read, besides the weights (one of CLAP_WEIGHTS).
CLAP_FILES = (
    "config.json", "preprocessor_config.json", "tokenizer.json", "tokenizer_config.json",
    "special_tokens_map.json", "vocab.json", "merges.txt",
)
CLAP_WEIGHTS = ("model.safetensors", "pytorch_model.bin")


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


def snapshot_dir(weights: Path, needs: tuple[str, ...], any_complete: bool = False) -> Path | None:
    """The snapshot the server loads (the one refs/main names, else any) when it has every file in `needs`.

    `any_complete`: when the one refs/main names isn't complete (a newer download stopped part way), any other
    complete one does. Only for models loaded from the folder found here (the sound effects): Breeze and Whisper
    are loaded by their name, which follows refs/main."""
    snapshots = weights / "snapshots"
    try:
        ref = (weights / "refs" / "main").read_text(encoding="utf-8").strip()
    except OSError:
        ref = ""
    try:
        others = sorted(p.name for p in snapshots.iterdir() if p.is_dir() and p.name != ref)
        named = [ref] if ref and (snapshots / ref).is_dir() else []
        names = named + others if (any_complete or not named) else named
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


def sound_weights_dir(root: Path) -> Path:
    return Path(root) / "models" / "hf" / "hub" / hub_folder(SOUND_REPO)


def clap_weights_dir(root: Path) -> Path:
    return Path(root) / "models" / "hf" / "hub" / hub_folder(CLAP_REPO)


def sound_mark(root: Path) -> Path:
    """Left by the sound effects' last download step once everything checked out."""
    return Path(root) / "models" / "sound" / ".ready"


def sound_dir(root: Path) -> Path | None:
    """Stable Audio Open's snapshot, with every part diffusers loads, or None."""
    weights = sound_weights_dir(root)
    if _half_downloaded(weights):
        return None
    return snapshot_dir(weights, SOUND_FILES, any_complete=True)


def clap_dir(root: Path) -> Path | None:
    """CLAP's snapshot, with its tokenizer, its settings and one copy of its weights, or None."""
    weights = clap_weights_dir(root)
    if _half_downloaded(weights):
        return None
    for name in CLAP_WEIGHTS:
        found = snapshot_dir(weights, CLAP_FILES + (name,), any_complete=True)
        if found is not None:
            return found
    return None


def sound_complete(root: Path) -> bool:
    """The sound effects at `root` can be loaded: their last download step left its mark, and both models are whole."""
    return sound_mark(root).is_file() and sound_dir(root) is not None and clap_dir(root) is not None
