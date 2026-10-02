# Adapted from Poor-Mans-Holodeck, tts/app/stt.py (Adam's rule, 2 October 2026: only speech code is reused).
"""Local dictation. Whisper and Parakeet are optional and only one is loaded.

AI Write downloads either one into the speech folder (models/parakeet, models/whisper) and says
which to use: at start-up (AIWRITE_DICTATION) and whenever Adam picks another (POST /v1/dictation).
Picking one loads it and drops the other; "none" drops both. Neither touches the voice models.
Both are English only and run on the processor, about a gigabyte at most, so the voices keep the
graphics card. A model left unused for five minutes is let go, and loads again when next asked.

Both write what was said. `clean` then drops fillers ("um", "uh") and stutters ("the the"),
keeping real doubles such as "had had".
"""

import gc
import importlib
import importlib.util
import re
import threading
import time
from pathlib import Path

from . import config

_lock = threading.Lock()
_choice = "none"
_whisper = None
_parakeet = None
_last_used = 0.0

# Only sounds that are never words ("um", "umm", "uh", "er", "erm"). "Ah", "hmm" and "mm" stay: in a
# story they are often meant, and so are "uh-huh" and "uh-oh", which the hyphen keeps.
_FILLER = re.compile(r"(?:\s*,\s*)?(?<!-)\b(?:u+m+|u+h+|er|erm+)\b(?!-)\s*,?", re.IGNORECASE)
# A stutter is a small word said twice ("the the", "I I"). Other doubles ("had had", "that that",
# "was was", "very very", "no no") are often meant, so they stay.
_STUTTER_WORDS = (
    "the", "a", "an", "i", "and", "to", "of", "it", "in", "at", "we", "he", "she", "they", "you",
    "my", "your", "our", "his", "but", "or", "for", "with", "as", "if", "this",
)
_REPEAT = re.compile(r"\b(" + "|".join(_STUTTER_WORDS) + r")(?:\s+\1\b)+", re.IGNORECASE)

PARAKEET_URL = (
    "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/"
    "sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8.tar.bz2"
)
# Whisper's English-only base model (Systran's CTranslate2 copy on Hugging Face).
WHISPER_MODEL = "base.en"


class DictationError(RuntimeError):
    """Why dictation can't run, in plain words: AI Write shows the message as it is."""


def choice() -> str:
    return _choice


def _has(module: str) -> bool:
    # A package installed while the server runs is only seen once the import system looks again.
    importlib.invalidate_caches()
    return importlib.util.find_spec(module) is not None


def _whisper_files() -> bool:
    root = config.WHISPER_DIR
    return root.is_dir() and any(root.glob("**/model.bin"))


def _whisper_ready() -> bool:
    return _has("faster_whisper") and _whisper_files()


def _parakeet_dir() -> Path | None:
    root = config.PARAKEET_DIR
    found = next(root.glob("**/encoder.int8.onnx"), None) if root.is_dir() else None
    return found.parent if found else None


def _parakeet_ready() -> bool:
    return _has("sherpa_onnx") and _parakeet_dir() is not None


def ready(engine: str) -> bool:
    return _parakeet_ready() if engine == "parakeet" else _whisper_ready() if engine == "whisper" else False


def loaded() -> str | None:
    """The dictation model in memory now, if any."""
    if _choice == "whisper" and _whisper is not None:
        return "whisper"
    if _choice == "parakeet" and _parakeet is not None:
        return "parakeet"
    return None


def statuses() -> list[dict]:
    """Both dictation models. Does not load either."""
    picked = choice()
    return [
        {
            "id": "parakeet",
            "name": "Parakeet",
            "blurb": "The sharper English dictation. The int8 copy stays on the processor, about 1 GB.",
            "ready": _parakeet_ready(),
            "loaded": _parakeet is not None and picked == "parakeet",
            "voices": 0,
            "detail": "tdt-0.6b · int8" if _parakeet_ready() else "Not downloaded. Download it in AI Write's Settings, Read aloud and dictation.",
        },
        {
            "id": "whisper",
            "name": "Whisper",
            "blurb": "Smaller English dictation on the processor, beside whichever voice is loaded.",
            "ready": _whisper_ready(),
            "loaded": _whisper is not None and picked == "whisper",
            "voices": 0,
            "detail": WHISPER_MODEL if _whisper_ready() else "Not downloaded. Download it in AI Write's Settings, Read aloud and dictation.",
        },
    ]


def clean(text: str) -> str:
    s = _FILLER.sub(" ", text or "")
    s = _REPEAT.sub(r"\1", s)
    s = re.sub(r"\s+([,.;:!?])", r"\1", s)
    # The commas a filler leaves behind: two in a row, or one before the end of the sentence. An
    # ellipsis ("um...") is kept.
    s = re.sub(r",(?:\s*,)+", ",", s)
    s = re.sub(r",\s*([.;:!?])", r"\1", s)
    s = re.sub(r"\s{2,}", " ", s).strip(" \t,;:")
    # Nothing but a filler ("Ummm.") leaves nothing to type.
    if not any(c.isalnum() for c in s):
        return ""
    # A filler that started the sentence leaves the next word in lower case.
    return s[:1].upper() + s[1:] if s[:1].islower() and (text or "").lstrip()[:1].isupper() else s


def _load_whisper():
    if not _whisper_ready():
        raise DictationError("Whisper isn't downloaded. Download it in Settings, Read aloud and dictation.")
    from faster_whisper import WhisperModel

    # From the copy on this computer only: nothing is fetched while the server runs.
    return WhisperModel(WHISPER_MODEL, device="cpu", compute_type="int8", download_root=str(config.WHISPER_DIR), local_files_only=True)


def _load_parakeet():
    folder = _parakeet_dir()
    if not _has("sherpa_onnx") or folder is None:
        raise DictationError("Parakeet isn't downloaded. Download it in Settings, Read aloud and dictation.")
    import sherpa_onnx

    return sherpa_onnx.OfflineRecognizer.from_transducer(
        encoder=str(folder / "encoder.int8.onnx"),
        decoder=str(folder / "decoder.int8.onnx"),
        joiner=str(folder / "joiner.int8.onnx"),
        tokens=str(folder / "tokens.txt"),
        model_type="nemo_transducer",
        num_threads=4,
        provider="cpu",
    )


def _drop() -> None:
    global _whisper, _parakeet
    _whisper = None
    _parakeet = None
    gc.collect()


def use(engine: str) -> str:
    """Load one dictation model and drop the other. `none` drops both."""
    global _choice, _whisper, _parakeet, _last_used
    engine = (engine or "none").strip().lower()
    if engine not in ("none", "whisper", "parakeet"):
        raise DictationError("Pick None, Whisper, or Parakeet.")
    with _lock:
        _drop()
        _choice = engine
        if engine == "whisper":
            _whisper = _load_whisper()
        elif engine == "parakeet":
            _parakeet = _load_parakeet()
        _last_used = time.time()
    return engine


def pick(engine: str) -> None:
    """Remember the choice without loading it (it loads on first use)."""
    global _choice
    engine = (engine or "none").strip().lower()
    if engine in ("none", "whisper", "parakeet"):
        with _lock:
            if engine != _choice:
                _drop()
            _choice = engine


def unload() -> bool:
    """Give the memory back; the chosen model loads again when next asked. True if one was loaded."""
    with _lock:
        was = loaded() is not None
        _drop()
    return was


def _hear_whisper(path: Path) -> str:
    # These clips are already one push of the key. The silence trimmer was eating the first word.
    segments, _info = _whisper.transcribe(str(path), vad_filter=False, language="en", condition_on_previous_text=False)
    return " ".join(s.text.strip() for s in segments if s.text.strip()).strip()


def _hear_parakeet(path: Path) -> str:
    import soundfile as sf

    audio, sample_rate = sf.read(path, dtype="float32", always_2d=False)
    if getattr(audio, "ndim", 1) > 1:
        audio = audio.mean(axis=1)
    stream = _parakeet.create_stream()
    stream.accept_waveform(int(sample_rate), audio)
    _parakeet.decode_stream(stream)
    return (stream.result.text or "").strip()


def transcribe(path: str | Path) -> str:
    global _whisper, _parakeet, _last_used
    path = Path(path)
    with _lock:
        # Let go after a quiet spell: load the chosen model again.
        if _choice == "whisper" and _whisper is None:
            _whisper = _load_whisper()
        elif _choice == "parakeet" and _parakeet is None:
            _parakeet = _load_parakeet()
        _last_used = time.time()
        if _choice == "whisper":
            raw = _hear_whisper(path)
        elif _choice == "parakeet":
            raw = _hear_parakeet(path)
        else:
            raise DictationError("No dictation engine is chosen. Pick Parakeet or Whisper in Settings, Read aloud and dictation.")
    return clean(raw)


def _idle_watch() -> None:
    while True:
        time.sleep(30)
        limit = config.idle_unload_seconds()
        if loaded() is not None and _last_used and time.time() - _last_used > limit:
            with _lock:
                if time.time() - _last_used > limit:
                    _drop()


def start_idle_watch() -> None:
    if config.idle_unload_seconds() <= 0:
        return
    threading.Thread(target=_idle_watch, name="dictation-idle-unload", daemon=True).start()


def parakeet_url() -> str:
    return PARAKEET_URL
