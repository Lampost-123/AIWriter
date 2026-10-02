# From mcreader-v2, tts/app/audio.py (Adam's rule, 2 October 2026: only speech code is reused).
"""Turning float samples into WAV bytes.

Breeze hands back float32 at 24 kHz, so nothing here resamples. What it does
do is the fiddly part that makes a run of sentences sound like one reading:
clip guard, a short fade at each end so joins do not click, and a little silence
after sentence-ending punctuation.
"""

import io

import numpy as np
import soundfile as sf

# Every engine in this server speaks at this rate (Kokoro and Chatterbox agree).
SAMPLE_RATE = 24000

# Leave a little headroom rather than normalizing every clip to full scale: a
# paragraph read as many clips would otherwise pump up and down between sentences.
PEAK_CEILING = 0.97
# Below this the clip is unusually quiet (some Chatterbox takes come out soft).
QUIET_FLOOR = 0.10
# A quiet clip is raised at most this much: a whispered line is meant to be quiet, and raising it
# tenfold raised its hiss with it.
QUIET_BOOST_MAX = 3.0

FADE_MS = 6
# The end fades for longer than the start: a model that stops in the middle of a sound otherwise stops with a click.
FADE_OUT_MS = 20
# Sentence-ending punctuation gets a beat of silence; the browser plays clips
# back to back with no gap of its own, so the pause has to be in the audio.
SENTENCE_PAUSE = 0.22
CLAUSE_PAUSE = 0.09


def _fade(x: np.ndarray, ms: int = FADE_MS, out_ms: int = FADE_OUT_MS) -> np.ndarray:
    """Ramp the first and last few milliseconds so spliced clips do not pop."""
    n = min(int(SAMPLE_RATE * ms / 1000), len(x) // 2)
    m = min(int(SAMPLE_RATE * out_ms / 1000), len(x) // 2)
    if n <= 0 or m <= 0:
        return x
    out = x.copy()
    out[:n] *= np.linspace(0.0, 1.0, n, dtype=np.float32)
    out[-m:] *= np.linspace(1.0, 0.0, m, dtype=np.float32)
    return out


# A stray sound after the line has ended: at most this long, after at least this much quiet, below the line's level by
# QUIET_DB. A model reading "I don't know," can go on into the start of a word that is not there, and in a joined
# audiobook that is heard as a click or a cut-off syllable. A stop's closure before its release is shorter than the gap.
STRAY_MS = 160
STRAY_GAP_MS = 120
QUIET_DB = 30.0
STEP_MS = 10


def trim_stray_tail(x: np.ndarray, sr: int = SAMPLE_RATE) -> np.ndarray:
    """The clip without a short burst of sound that comes after the words have finished and a clear gap."""
    hop = max(1, sr * STEP_MS // 1000)
    frames = len(x) // hop
    if frames < 10:
        return x
    rms = np.sqrt(np.mean(x[: frames * hop].reshape(frames, hop).astype(np.float64) ** 2, axis=1))
    level = float(np.sqrt(np.mean(x.astype(np.float64) ** 2)))
    if level <= 0:
        return x
    loud = rms > level * 10 ** (-QUIET_DB / 20)
    last = int(np.flatnonzero(loud)[-1]) if loud.any() else -1
    if last < 0:
        return x
    start = last
    while start > 0 and loud[start - 1]:
        start -= 1
    gap_end = start
    while start > 0 and not loud[start - 1]:
        start -= 1
    burst, gap = (last + 1 - gap_end) * STEP_MS, (gap_end - start) * STEP_MS
    # Only when real speech comes before the gap: a clip that is one short word keeps it.
    if start == 0 or burst > STRAY_MS or gap < STRAY_GAP_MS or loud[:start].sum() * STEP_MS < 3 * STRAY_MS:
        return x
    # Keep the start of the gap: the last word's own decay lives there.
    return x[: (start + min(gap_end - start, STRAY_GAP_MS // STEP_MS // 2)) * hop]


def clean(samples) -> np.ndarray:
    """Float32 mono, finite, and at a sane level."""
    x = np.asarray(samples, dtype=np.float32).reshape(-1)
    if x.size == 0:
        return x
    x = np.nan_to_num(x, nan=0.0, posinf=0.0, neginf=0.0)
    peak = float(np.max(np.abs(x)))
    if peak > PEAK_CEILING:
        x = x * (PEAK_CEILING / peak)
    elif 0.0 < peak < QUIET_FLOOR:
        x = x * min(QUIET_FLOOR / peak, QUIET_BOOST_MAX)
    return x


def ends_sentence(text: str) -> bool:
    return text.rstrip().endswith((".", "!", "?", "…", '"', "'", "”", "’"))


def tail_silence(text: str) -> float:
    """How long a pause this piece of text should be followed by."""
    stripped = text.rstrip()
    if not stripped:
        return 0.0
    if stripped.endswith((".", "!", "?", "…")):
        return SENTENCE_PAUSE
    if stripped.endswith((",", ";", ":", "—", "–")):
        return CLAUSE_PAUSE
    return 0.04


def to_wav(samples, sr: int = SAMPLE_RATE, tail: float = 0.0) -> bytes:
    """WAV bytes (16-bit PCM) with a short fade and an optional pause on the end."""
    x = clean(samples)
    if x.size == 0:
        # A WAV header with no samples is still valid, and better than an error:
        # the browser plays it as silence and moves on to the next sentence.
        x = np.zeros(int(sr * 0.02), dtype=np.float32)
    x = _fade(x)
    if tail > 0:
        x = np.concatenate([x, np.zeros(int(sr * tail), dtype=np.float32)])
    buf = io.BytesIO()
    sf.write(buf, x, sr, format="WAV", subtype="PCM_16")
    return buf.getvalue()
