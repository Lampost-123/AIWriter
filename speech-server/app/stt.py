# Adapted from Poor-Mans-Holodeck, tts/app/stt.py (Adam's rule, 2 October 2026: only speech code is reused).
"""Local dictation. Whisper and Parakeet are optional and only one is loaded.

AI Write downloads either one into the speech folder (models/parakeet, models/whisper) and says
which to use: at start-up (AIWRITE_DICTATION) and whenever Adam picks another (POST /v1/dictation).
Picking one loads it and drops the other; "none" drops both. Neither touches the voice models.
Both are English only and run on the processor, about a gigabyte at most, so the voices keep the
graphics card. A model left unused for five minutes is let go, and loads again when next asked.

Both write what was said. `clean` then drops fillers ("um", "uh") and stutters ("the the"),
keeping real doubles such as "had had".

AI Write's addition: `align` says when each word of a spoken clip is heard, so a sound effect fires on its
word. It uses the chosen dictation model (loading it, as dictating would), and with none chosen, whichever is
downloaded (Whisper first) in a slot of its own that never changes the choice and is let go like the other.
Nothing is cleaned for it: every word said counts.
"""

import gc
import importlib
import importlib.util
import re
import threading
import time
from pathlib import Path

from . import config, downloaded

_lock = threading.Lock()
_choice = "none"
_whisper = None
_parakeet = None
_last_used = 0.0
# The model `align` loaded because no dictation model is chosen: (engine, model), or None. It has its own lock, so
# timing words with it never holds up dictation; and when it was last used.
_aligner = None
_align_lock = threading.Lock()
_aligner_used = 0.0
# Why each model couldn't be loaded the last time it was asked for (gone once it loads): /v1/health says
# so, and AI Write's Settings explains it in plain words, with the fix.
_load_errors: dict[str, str] = {}

# Only sounds that are never words ("um", "umm", "uh", "er", "erm"). "Ah", "hmm" and "mm" stay: in a
# story they are often meant, and so are "uh-huh" and "uh-oh" (hyphen or not).
_FILLER = re.compile(r"(?:\s*,\s*)?(?<!-)\b(?:u+m+|u+h+(?!\s+oh\b)|er|erm+)\b(?!-)\s*,?", re.IGNORECASE)
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


class AlignBusy(RuntimeError):
    """The chosen dictation model is busy writing down what Adam said: dictation goes first, so the words aren't timed now."""


def choice() -> str:
    return _choice


def _has(module: str) -> bool:
    # A package installed while the server runs is only seen once the import system looks again.
    importlib.invalidate_caches()
    return importlib.util.find_spec(module) is not None


def _whisper_files() -> bool:
    # All of its files, so a download stopped part way never counts.
    return downloaded.whisper_dir(config.WHISPER_DIR) is not None


def _whisper_ready() -> bool:
    return _has("faster_whisper") and _whisper_files()


def _parakeet_dir() -> Path | None:
    # All four of its files in one folder: one being unpacked (models/parakeet/.unpack) never counts.
    return downloaded.parakeet_dir(config.PARAKEET_DIR)


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
            "detail": "tdt-0.6b · int8" if _parakeet_ready() else "Not installed. Download it in AI Write's Settings, Read aloud and dictation.",
            "loadError": _load_errors.get("parakeet", ""),
        },
        {
            "id": "whisper",
            "name": "Whisper",
            "blurb": "Smaller English dictation on the processor, beside whichever voice is loaded.",
            "ready": _whisper_ready(),
            "loaded": _whisper is not None and picked == "whisper",
            "voices": 0,
            "detail": WHISPER_MODEL if _whisper_ready() else "Not installed. Download it in AI Write's Settings, Read aloud and dictation.",
            "loadError": _load_errors.get("whisper", ""),
        },
    ]


def clean(text: str) -> str:
    s = _FILLER.sub(" ", text or "")
    s = _REPEAT.sub(r"\1", s)
    s = re.sub(r"\s+([,.;:!?])", r"\1", s)
    # A filler between two pauses ("Wait... um... what?") leaves one pause, not two run together.
    s = re.sub(r"(\.\.\.|…)(?:\s*(?:\.\.\.|…))+", r"\1", s)
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
        raise DictationError("Whisper is not installed. Download it in Settings, Read aloud and dictation.")
    from faster_whisper import WhisperModel

    # From the copy on this computer only: nothing is fetched while the server runs.
    return WhisperModel(WHISPER_MODEL, device="cpu", compute_type="int8", download_root=str(config.WHISPER_DIR), local_files_only=True)


def _load_parakeet():
    folder = _parakeet_dir()
    if not _has("sherpa_onnx") or folder is None:
        raise DictationError("Parakeet is not installed. Download it in Settings, Read aloud and dictation.")
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


def _load(engine: str):
    """Load `engine`'s model, remembering why when it can't be (one that isn't downloaded just says so)."""
    try:
        model = _load_whisper() if engine == "whisper" else _load_parakeet()
    except DictationError:
        raise
    except Exception as exc:
        _load_errors[engine] = f"{exc.__class__.__name__}: {exc}"
        raise
    _load_errors.pop(engine, None)
    return model


def _drop() -> None:
    """Lets go of the dictation models, and the aligner's. Called with _lock held (then _align_lock, never the other way)."""
    global _whisper, _parakeet
    _whisper = None
    _parakeet = None
    with _align_lock:
        _drop_aligner()
    gc.collect()


def _drop_aligner() -> None:
    """Lets go of the aligner's model. Called with _align_lock held."""
    global _aligner
    _aligner = None


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
            _whisper = _load("whisper")
        elif engine == "parakeet":
            _parakeet = _load("parakeet")
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
        was = loaded() is not None or _aligner is not None
        _drop()
    return was


WHISPER_RATE = 16000


def resample(samples, rate: int, target: int):
    """Mono float32 at `target` Hz, band-limited (through the spectrum), so nothing above the new rate folds back in."""
    import numpy as np

    x = np.asarray(samples, dtype=np.float32).reshape(-1)
    if rate == target or x.size == 0:
        return x
    n = max(1, int(round(x.size * target / rate)))
    spectrum = np.fft.rfft(x)
    keep = n // 2 + 1
    if spectrum.size >= keep:
        spectrum = spectrum[:keep]
    else:
        spectrum = np.concatenate([spectrum, np.zeros(keep - spectrum.size, dtype=spectrum.dtype)])
    return (np.fft.irfft(spectrum, n) * (n / x.size)).astype(np.float32)


def whisper_audio(path: Path):
    """The clip as Whisper hears it: mono at 16 kHz. Read here, not by faster-whisper: its own reader (PyAV) changes
    from one version to the next (19 no longer opens files the way faster-whisper 1.2 asks)."""
    import soundfile as sf

    audio, sample_rate = sf.read(path, dtype="float32", always_2d=False)
    if getattr(audio, "ndim", 1) > 1:
        audio = audio.mean(axis=1)
    return resample(audio, int(sample_rate), WHISPER_RATE)


def _hear_whisper(path: Path) -> str:
    # These clips are already one push of the key. The silence trimmer was eating the first word.
    segments, _info = _whisper.transcribe(whisper_audio(path), vad_filter=False, language="en", condition_on_previous_text=False)
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
            _whisper = _load("whisper")
        elif _choice == "parakeet" and _parakeet is None:
            _parakeet = _load("parakeet")
        _last_used = time.time()
        if _choice == "whisper":
            raw = _hear_whisper(path)
        elif _choice == "parakeet":
            raw = _hear_parakeet(path)
        else:
            raise DictationError("No dictation model is loaded. Pick Parakeet or Whisper in Settings, Read aloud and dictation.")
    return clean(raw)


def _idle_watch() -> None:
    while True:
        time.sleep(30)
        limit = config.idle_unload_seconds()
        if loaded() is not None and _last_used and time.time() - _last_used > limit:
            with _lock:
                if time.time() - _last_used > limit:
                    _drop()
        if _aligner is not None and time.time() - _aligner_used > limit:
            with _align_lock:
                if time.time() - _aligner_used > limit:
                    _drop_aligner()
                    gc.collect()


def start_idle_watch() -> None:
    if config.idle_unload_seconds() <= 0:
        return
    threading.Thread(target=_idle_watch, name="dictation-idle-unload", daemon=True).start()


def parakeet_url() -> str:
    return PARAKEET_URL


# --- when each word is heard ------------------------------------------------

# Parakeet marks the first piece of each word with this.
WORD_START = "▁"
# How long the last word lasts after its last piece starts, when Parakeet doesn't say (nothing comes after it).
LAST_WORD_SECONDS = 0.4


def aligner() -> str | None:
    """The dictation model `align` would use: the one chosen when it is downloaded, else Whisper, else Parakeet,
    else None (nothing to time the words with)."""
    if _choice in ("whisper", "parakeet") and ready(_choice):
        return _choice
    if _whisper_ready():
        return "whisper"
    if _parakeet_ready():
        return "parakeet"
    return None


def group_pieces(
    tokens: list[str], starts: list[float], durations: list[float] | None = None, end: float | None = None
) -> list[dict]:
    """Parakeet's pieces ("▁sl", "am", "med", ".") and when each starts, as words with their start and end.

    A new word starts at a piece marked "▁" (or a space); punctuation on its own stays with the word before. A word
    ends after its last piece: by that piece's duration when Parakeet gives one, else where the next word starts (at
    most LAST_WORD_SECONDS later, so a pause isn't counted as part of the word). Nothing ends after `end`.
    """
    words: list[list] = []  # [text, start, last piece's start, last piece's duration or None]
    # A word mark on its own: the next piece with letters in it starts a word, from the mark's time.
    pending: float | None = None
    for i, (piece, at) in enumerate(zip(tokens, starts)):
        text = str(piece)
        bare = text.replace(WORD_START, " ").strip()
        duration = float(durations[i]) if durations and i < len(durations) and durations[i] > 0 else None
        marked = text.startswith((WORD_START, " "))
        if marked and not bare:
            if pending is None:
                pending = float(at)
            continue
        wordy = any(c.isalnum() for c in bare)
        if (wordy and (marked or pending is not None)) or not words:
            words.append([bare, pending if pending is not None and wordy else float(at), float(at), duration])
            if wordy:
                pending = None
        else:
            words[-1][0] += bare
            words[-1][2] = float(at)
            words[-1][3] = duration
    out: list[dict] = []
    for n, (text, start, last, duration) in enumerate(words):
        if not text:
            continue
        following = words[n + 1][1] if n + 1 < len(words) else None
        if duration is not None:
            stop = last + duration
        elif following is not None:
            stop = min(following, last + LAST_WORD_SECONDS)
        else:
            stop = last + LAST_WORD_SECONDS
        if following is not None:
            stop = min(stop, following)
        if end is not None:
            stop = min(stop, end)
        out.append({"word": text, "start": round(start, 3), "end": round(max(stop, start), 3)})
    return out


def _align_whisper(model, path: Path) -> list[dict]:
    segments, _info = model.transcribe(
        whisper_audio(path), vad_filter=False, language="en", condition_on_previous_text=False, word_timestamps=True,
    )
    words: list[dict] = []
    for segment in segments:
        for w in segment.words or []:
            text = (w.word or "").strip()
            if text:
                words.append({"word": text, "start": round(float(w.start), 3), "end": round(float(w.end), 3)})
    return words


def _align_parakeet(model, path: Path) -> list[dict]:
    import soundfile as sf

    audio, sample_rate = sf.read(path, dtype="float32", always_2d=False)
    if getattr(audio, "ndim", 1) > 1:
        audio = audio.mean(axis=1)
    stream = model.create_stream()
    stream.accept_waveform(int(sample_rate), audio)
    model.decode_stream(stream)
    result = stream.result
    durations = list(getattr(result, "durations", None) or []) or None
    return group_pieces(list(result.tokens), list(result.timestamps), durations, len(audio) / float(sample_rate))


def align(path: str | Path) -> tuple[list[dict], str]:
    """When each word of a spoken clip is heard: ([{"word", "start", "end"}], the engine used), in seconds from its
    start. Raises DictationError when no dictation model is downloaded, and AlignBusy when the chosen one is busy
    with dictation, which always goes first (AI Write then places the sounds by an estimate)."""
    global _whisper, _parakeet, _aligner, _last_used, _aligner_used
    path = Path(path)
    engine = aligner()
    if engine is None:
        raise DictationError("No dictation model is downloaded, so the words can't be timed.")
    if engine == _choice:
        # The chosen model, loaded as dictating would load it; never ahead of dictation waiting for it.
        if not _lock.acquire(blocking=False):
            raise AlignBusy("Dictation is using its model now.")
        try:
            if _choice != engine:
                raise AlignBusy("The dictation model is changing.")
            if engine == "whisper" and _whisper is None:
                _whisper = _load("whisper")
            elif engine == "parakeet" and _parakeet is None:
                _parakeet = _load("parakeet")
            model = _whisper if engine == "whisper" else _parakeet
            _last_used = time.time()
            words = _align_whisper(model, path) if engine == "whisper" else _align_parakeet(model, path)
        finally:
            _lock.release()
        return words, engine
    # None chosen (or the one chosen isn't downloaded): a slot of its own, which never changes the choice or waits
    # for dictation.
    with _align_lock:
        if _aligner is None or _aligner[0] != engine:
            _aligner = None
            _aligner = (engine, _load(engine))
        model = _aligner[1]
        _aligner_used = time.time()
        words = _align_whisper(model, path) if engine == "whisper" else _align_parakeet(model, path)
        _aligner_used = time.time()
    return words, engine
