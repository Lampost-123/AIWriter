"""Shaping what Stable Audio Open makes into sounds AI Write can play under a reading: numpy only, so it is
tested without torch (and the sound effects' worker imports it from the speech server's source).

Stable Audio Open's takes come out at very different levels (one test take peaked at 0.05), often with
silence before and after the sound, and they don't loop. So every sound is:

* an effect: trimmed of the near-silence before and after it (so it is heard on the word it belongs to, not
  a moment later), with short fades so the cut never clicks;
* ambience: made a little longer than asked, then the extra at its end is crossfaded into its start
  (equal power, LOOP_FADE seconds), so it loops with no click and no dip: the last sample runs on into the
  first. It gets no fades, which would be heard as a dip at the loop point;
* both: brought to one loudness, TARGET_LUFS, measured as ITU-R BS.1770 does (K-weighted, gated over
  400 ms blocks; here the K-weighting is applied by its magnitude in the frequency domain, which measures the
  same power without a filter loop), then turned down if needed so no sample is above PEAK_CEILING_DB.

-20 LUFS sits a little under narration (audiobook voices are usually mastered around -18 to -16), so a sound
played at full volume never drowns the words; the window sets each kind's own level from there.
"""

import numpy as np

# One loudness for every sound, and the loudest any sample may be.
TARGET_LUFS = -20.0
PEAK_CEILING_DB = -1.0
# A very quiet take is raised at most this much: past it, what is raised is the model's hiss.
MAX_GAIN_DB = 40.0

# Trimming an effect: what counts as sound is within TRIM_DB of its loudest 10 ms; a little is kept before the
# first sound (its attack) and after the last (its decay, then a fade).
TRIM_DB = 45.0
TRIM_FLOOR_DB = -70.0
KEEP_BEFORE_S = 0.01
KEEP_AFTER_S = 0.15
FADE_IN_S = 0.004
FADE_OUT_S = 0.05

# Ambience: how much longer it is made than asked, crossfaded into its start to make the loop.
LOOP_FADE = 2.0

_BLOCK_S = 0.4
_STEP_S = 0.1
_ABSOLUTE_GATE = -70.0
_RELATIVE_GATE = -10.0


def as_frames(samples) -> np.ndarray:
    """Float32 (frames, channels), finite. Mono comes in as (frames,)."""
    x = np.asarray(samples, dtype=np.float32)
    if x.ndim == 1:
        x = x[:, None]
    elif x.ndim != 2:
        x = x.reshape(x.shape[0], -1)
    return np.nan_to_num(x, nan=0.0, posinf=0.0, neginf=0.0)


def _db(power: float) -> float:
    return 10.0 * np.log10(max(power, 1e-20))


def _k_weight_gain(freqs: np.ndarray) -> np.ndarray:
    """|H(f)|² of BS.1770's K-weighting (its 48 kHz filters, read at each frequency)."""
    z = np.exp(1j * 2 * np.pi * freqs / 48000.0)

    def biquad(b, a):
        return (b[0] + b[1] / z + b[2] / z**2) / (a[0] + a[1] / z + a[2] / z**2)

    shelf = biquad((1.53512485958697, -2.69169618940638, 1.19839281085285), (1.0, -1.69065929318241, 0.73248077421585))
    high_pass = biquad((1.0, -2.0, 1.0), (1.0, -1.99004745483398, 0.99007225036621))
    return np.abs(shelf * high_pass) ** 2


def k_weighted(x: np.ndarray, sr: int) -> np.ndarray:
    """The sound through the K-weighting, by its magnitude (zero phase): the same power in every block."""
    x = as_frames(x)
    n = x.shape[0]
    if n == 0:
        return x
    size = 1 << int(np.ceil(np.log2(max(2, n))))
    spectrum = np.fft.rfft(x, n=size, axis=0)
    gain = np.sqrt(_k_weight_gain(np.fft.rfftfreq(size, 1.0 / sr)))
    return np.fft.irfft(spectrum * gain[:, None], n=size, axis=0)[:n].astype(np.float32)


def loudness(samples, sr: int) -> float:
    """Integrated loudness in LUFS (BS.1770's gating); -inf for silence. A sound shorter than one 400 ms block
    is measured as one block."""
    y = k_weighted(samples, sr).astype(np.float64)
    n = y.shape[0]
    if n == 0:
        return float("-inf")
    block = int(round(_BLOCK_S * sr))
    step = int(round(_STEP_S * sr))
    if n <= block:
        starts = [0]
        block = n
    else:
        starts = list(range(0, n - block + 1, step))
    # Each block's mean square, added up over the channels (every channel weighs 1: no surround here).
    powers = np.array([float(np.mean(y[s:s + block] ** 2, axis=0).sum()) for s in starts])
    levels = -0.691 + 10.0 * np.log10(np.maximum(powers, 1e-20))
    kept = powers[levels > _ABSOLUTE_GATE]
    if kept.size == 0:
        return float("-inf")
    relative = -0.691 + _db(float(kept.mean())) + _RELATIVE_GATE
    kept = powers[(levels > _ABSOLUTE_GATE) & (levels > relative)]
    if kept.size == 0:
        return float("-inf")
    return -0.691 + _db(float(kept.mean()))


def normalise(samples, sr: int, target: float = TARGET_LUFS, ceiling_db: float = PEAK_CEILING_DB) -> np.ndarray:
    """Brought to `target` LUFS, then turned down if a sample would be above `ceiling_db`. Silence stays silent."""
    x = as_frames(samples)
    level = loudness(x, sr)
    peak = float(np.max(np.abs(x))) if x.size else 0.0
    if not np.isfinite(level) or peak <= 0:
        return x
    gain_db = min(target - level, MAX_GAIN_DB)
    ceiling = 10 ** (ceiling_db / 20)
    gain = min(10 ** (gain_db / 20), ceiling / peak)
    return (x * gain).astype(np.float32)


def _frame_levels(x: np.ndarray, hop: int) -> np.ndarray:
    frames = x.shape[0] // hop
    if frames == 0:
        return np.zeros(0)
    mono = np.mean(x[: frames * hop].astype(np.float64) ** 2, axis=1)
    return np.sqrt(mono.reshape(frames, hop).mean(axis=1))


def trim(samples, sr: int) -> np.ndarray:
    """Without the near-silence before and after the sound, keeping its attack and some of its decay. Nothing
    but near-silence leaves nothing."""
    x = as_frames(samples)
    hop = max(1, sr // 100)
    levels = _frame_levels(x, hop)
    if levels.size == 0:
        return x[:0]
    loudest = float(levels.max())
    floor = 10 ** (TRIM_FLOOR_DB / 20)
    if loudest <= floor:
        return x[:0]
    heard = np.flatnonzero(levels >= max(loudest * 10 ** (-TRIM_DB / 20), floor))
    start = max(0, int(heard[0]) * hop - int(KEEP_BEFORE_S * sr))
    end = min(x.shape[0], (int(heard[-1]) + 1) * hop + int(KEEP_AFTER_S * sr))
    return x[start:end]


def fade(samples, sr: int, fade_in: float = FADE_IN_S, fade_out: float = FADE_OUT_S) -> np.ndarray:
    """Short ramps at each end, so the sound never starts or stops with a click."""
    x = as_frames(samples).copy()
    n = x.shape[0]
    i = min(int(fade_in * sr), n // 2)
    o = min(int(fade_out * sr), n // 2)
    if i > 0:
        x[:i] *= np.linspace(0.0, 1.0, i, dtype=np.float32)[:, None]
    if o > 0:
        x[-o:] *= np.linspace(1.0, 0.0, o, dtype=np.float32)[:, None]
    return x


def loop(samples, sr: int, fade_s: float = LOOP_FADE) -> np.ndarray:
    """A seamless loop from a sound `fade_s` longer than the loop: its last `fade_s` seconds are crossfaded into
    its first (equal power), so the loop's last sample runs on into its first."""
    x = as_frames(samples)
    f = int(round(fade_s * sr))
    f = min(f, x.shape[0] // 3)
    if f <= 0:
        return x
    length = x.shape[0] - f
    t = (np.arange(f, dtype=np.float64) + 0.5) / f
    rise = np.sin(t * np.pi / 2)[:, None]
    fall = np.cos(t * np.pi / 2)[:, None]
    out = x[:length].astype(np.float64).copy()
    out[:f] = x[:f] * rise + x[length:] * fall
    return out.astype(np.float32)


def shape(samples, sr: int, kind: str, longest: float) -> np.ndarray:
    """A take made into the sound AI Write keeps: an effect trimmed, cut to `longest` seconds at most, faded; ambience
    looped (it was made LOOP_FADE seconds longer than asked); both brought to one loudness."""
    if kind == "ambience":
        x = loop(samples, sr)
    else:
        x = trim(samples, sr)
        if x.shape[0] > int(longest * sr):
            x = x[: int(longest * sr)]
        x = fade(x, sr)
    return normalise(x, sr)


def interleaved(samples) -> bytes:
    """The frames as float32, channel by channel within each frame (what the worker sends back)."""
    return np.ascontiguousarray(as_frames(samples), dtype=np.float32).tobytes()
