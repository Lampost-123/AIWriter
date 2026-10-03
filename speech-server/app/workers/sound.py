"""The sound effects: Stable Audio Open makes a few takes of a sound, and CLAP keeps the one closest to its description.

Runs in venvs/sound (torch with CUDA, diffusers, transformers), started by app/engines/sound_engine.py. One JSON
line in, one out:

    {"prompt": "a heavy wooden door slamming shut", "kind": "effect" | "ambience", "seconds": 3, "takes": 3, "seed": null}
    {"sr": 44100, "channels": 2, "b64": <float32, frames interleaved>, "score": 0.31, "seconds": 1.42}   or   {"error": "..."}

Its own loop rather than `_common.serve`, whose finish makes 24 kHz mono speech; the stdout guard, `_say` and
ending with the server come from `_common` all the same.

How a sound is made:

* The description goes first, then a few words on what kind of recording it is (a close, clean, single effect;
  or a steady background), as Stable Audio Open was trained on such descriptions. The negative prompt keeps
  music out, and for effects talking too, unless the sound is a voice (a scream, a laugh, a crowd).
* The takes are made one after another: together they need nearly three times the graphics card memory. 100
  steps each, in half precision, about 10 seconds a take on an RTX 5070 Ti (the first after loading takes longer).
  Only the part of the model's 47 second window that is wanted is turned into sound, a piece at a time, and the
  memory PyTorch keeps cached is given back after loading and after each sound: about 3 GB held between sounds,
  about 4 GB at the most while one is made.
* Each take is shaped as app/sound_audio.py says (trimmed or looped, one loudness), and CLAP, on the processor,
  scores how well it matches the plain description; the best is kept.
"""

import base64
import json
import math
import os
import re
import sys
import time
import traceback
from pathlib import Path

import numpy as np

from .. import sound_audio
from ._common import _say

# Where the server says the models are: their snapshots in the speech folder's Hugging Face cache.
SOUND_MODEL = os.environ.get("AIWRITE_SOUND_MODEL", "")
CLAP_MODEL = os.environ.get("AIWRITE_CLAP_MODEL", "")

STEPS = 100
NEGATIVE = "low quality, music"
NEGATIVE_EFFECT = "low quality, music, speech, talking"
# A sound that is a voice keeps voices: a scream, a laugh, a crowd.
VOICED = re.compile(
    r"\b(?:voice|scream|shout|yell|laugh|giggl|cry|cries|crying|sob|gasp|whisper|sigh|cough|sneez|crowd|people|"
    r"child|baby|babies|chatter|murmur|cheer|sing|chant|talk|speech|groan|moan)"
    r"|\b(?:man|men|woman|women|boy|girl)\b",
    re.IGNORECASE,
)
# CLAP hears mono at 48 kHz.
CLAP_RATE = 48000


def described(prompt: str, kind: str) -> str:
    """What Stable Audio Open is asked for: the description first, then the kind of recording."""
    prompt = prompt.strip().rstrip(".")
    if kind == "ambience":
        return f"{prompt}. Steady background ambience, a continuous field recording with no sudden sounds."
    return f"{prompt}. A single sound effect, close and clean, isolated, with nothing else in the background."


def negative_for(prompt: str, kind: str) -> str:
    return NEGATIVE_EFFECT if kind == "effect" and not VOICED.search(prompt) else NEGATIVE


def load() -> dict:
    for name, folder, file in (("Stable Audio Open", SOUND_MODEL, "model_index.json"), ("CLAP", CLAP_MODEL, "config.json")):
        if not folder or not (Path(folder) / file).is_file():
            raise RuntimeError(f"{name}'s files are missing. Download the sound effects again in Settings, Read aloud and dictation.")

    import torch
    from diffusers import StableAudioPipeline
    from transformers import ClapModel, ClapProcessor

    gpu = torch.cuda.is_available()
    if not gpu:
        print("Sound effects: no GPU visible; each take will take minutes on the processor.", file=sys.stderr)
    device = "cuda" if gpu else "cpu"
    t0 = time.perf_counter()
    # From the folder on this computer: the server runs offline, and the repository's own name would look for its
    # original checkpoint, which isn't downloaded.
    pipe = StableAudioPipeline.from_pretrained(SOUND_MODEL, dtype=torch.float16 if gpu else torch.float32, local_files_only=True)
    pipe = pipe.to(device)
    pipe.set_progress_bar_config(disable=True)
    # CLAP stays on the processor: it scores a few seconds of audio quickly, and leaves the graphics card to the voices.
    clap = ClapModel.from_pretrained(CLAP_MODEL, local_files_only=True).eval()
    processor = ClapProcessor.from_pretrained(CLAP_MODEL, local_files_only=True)
    print(f"Sound effects: loaded in {time.perf_counter() - t0:.1f} s on {device}.", file=sys.stderr)
    give_back(torch, "after loading")
    return {
        "torch": torch,
        "pipe": pipe,
        "clap": clap,
        "processor": processor,
        "device": device,
        "sr": int(getattr(pipe.vae, "sampling_rate", 44100)),
        "name": torch.cuda.get_device_name(0) if gpu else "cpu",
    }


def give_back(torch, when: str) -> None:
    """Hands the graphics card memory PyTorch keeps cached (but isn't using) back, so the voices can have it, and
    says what is left: the model itself, and the most a take needed."""
    if not torch.cuda.is_available():
        return
    peak = torch.cuda.max_memory_reserved() / 2**20
    torch.cuda.empty_cache()
    held = torch.cuda.memory_reserved() / 2**20
    print(f"Sound effects: graphics card memory {when}: {held:.0f} MiB held, {peak:.0f} MiB at most.", file=sys.stderr)
    torch.cuda.reset_peak_memory_stats()


def take(state: dict, prompt: str, negative: str, seconds: float, seed: int) -> np.ndarray:
    """One take, (frames, channels) float32."""
    torch = state["torch"]
    pipe = state["pipe"]
    generator = torch.Generator(device=state["device"]).manual_seed(seed)
    with torch.inference_mode():
        # The pipeline always makes its whole 47 second window, and would turn all of it into sound before cutting it
        # to length: that was the most the graphics card ever held (about 7.5 GB). Only what is needed is decoded here.
        latents = pipe(
            prompt,
            negative_prompt=negative,
            num_inference_steps=STEPS,
            audio_end_in_s=seconds,
            num_waveforms_per_prompt=1,
            generator=generator,
            output_type="latent",
        ).audios
        audio = decode(pipe, latents, seconds, state["sr"], torch)
    return np.asarray(audio.float().cpu().numpy(), dtype=np.float32).T


# Decoded in pieces of this many frames of the model's (2048 samples each, about 6 seconds), each with this many more on
# either side so its edges sound as they would decoded whole: about 3.8 GB at most rather than 7.5 for the whole window,
# and the same sound to within half-precision rounding (tried against a whole decode: mean difference 0.00002).
DECODE_FRAMES = 128
DECODE_CONTEXT = 16


def decode(pipe, latents, seconds: float, sr: int, torch):
    """The first `seconds` of the take as sound, (channels, samples)."""
    hop = int(pipe.vae.hop_length)
    frames = min(latents.shape[-1], math.ceil(seconds * sr / hop) + 4)
    parts = []
    for start in range(0, frames, DECODE_FRAMES):
        end = min(frames, start + DECODE_FRAMES)
        lo, hi = max(0, start - DECODE_CONTEXT), min(latents.shape[-1], end + DECODE_CONTEXT)
        wave = pipe.vae.decode(latents[..., lo:hi]).sample
        parts.append(wave[..., (start - lo) * hop:(end - lo) * hop])
    return torch.cat(parts, dim=-1)[0, :, : int(round(seconds * sr))]


def scores(state: dict, description: str, clips: list[np.ndarray], sr: int) -> list[float]:
    """How well each clip matches the description, as CLAP hears it (higher is closer)."""
    torch = state["torch"]
    import torchaudio.functional as F

    heard = []
    for clip in clips:
        mono = torch.from_numpy(np.ascontiguousarray(clip.mean(axis=1), dtype=np.float32))
        heard.append(F.resample(mono, sr, CLAP_RATE).numpy())
    processor = state["processor"]
    try:
        inputs = processor(text=[description], audio=heard, sampling_rate=CLAP_RATE, return_tensors="pt", padding=True)
    except TypeError:
        # Older transformers name it `audios`.
        inputs = processor(text=[description], audios=heard, sampling_rate=CLAP_RATE, return_tensors="pt", padding=True)
    with torch.inference_mode():
        out = state["clap"](**inputs)
    return [float(v) for v in out.logits_per_audio[:, 0]]


def make(state: dict, req: dict) -> dict:
    prompt = str(req.get("prompt") or "").strip()
    if not prompt:
        raise ValueError("no description")
    kind = "ambience" if req.get("kind") == "ambience" else "effect"
    seconds = float(req.get("seconds") or 3.0)
    takes = max(1, int(req.get("takes") or 1))
    seed = req.get("seed")
    seed = int(seed) if seed is not None else int.from_bytes(os.urandom(4), "little")
    sr = state["sr"]
    # Ambience is made longer than asked: the extra is crossfaded into its start to make the loop.
    length = seconds + sound_audio.LOOP_FADE if kind == "ambience" else seconds
    words, negative = described(prompt, kind), negative_for(prompt, kind)

    made: list[np.ndarray] = []
    for i in range(takes):
        t0 = time.perf_counter()
        raw = take(state, words, negative, length, (seed + i) % 2**32)
        peak = float(np.max(np.abs(raw))) if raw.size else 0.0
        shaped = sound_audio.shape(raw, sr, kind, seconds)
        print(f"Sound effects: take {i + 1} of {takes} in {time.perf_counter() - t0:.1f} s (raw peak {peak:.2f}).", file=sys.stderr)
        # A take that came out silent (it happens) isn't one to keep.
        if shaped.shape[0] >= int(0.05 * sr) and float(np.max(np.abs(shaped))) > 1e-4:
            made.append(shaped)
    if not made:
        raise RuntimeError("every take came out silent. Try describing it differently")
    give_back(state["torch"], "after the takes")
    ranked = scores(state, prompt, made, sr)
    best = int(np.argmax(ranked))
    print(f"Sound effects: CLAP scores {', '.join(f'{s:.2f}' for s in ranked)}; kept take {best + 1}.", file=sys.stderr)
    clip = made[best]
    return {
        "sr": sr,
        "channels": int(clip.shape[1]),
        "b64": base64.b64encode(sound_audio.interleaved(clip)).decode("ascii"),
        "score": round(ranked[best], 4),
        "seconds": round(clip.shape[0] / sr, 3),
    }


def main() -> None:
    try:
        state = load()
    except Exception as exc:  # noqa: BLE001 - said to the server, which says it to AI Write
        traceback.print_exc()
        _say({"error": f"{exc.__class__.__name__}: {exc}"})
        return
    _say({"ok": True, "device": state["name"]})
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            _say(make(state, json.loads(line)))
        except Exception as exc:  # noqa: BLE001
            traceback.print_exc()
            _say({"error": f"{exc.__class__.__name__}: {exc}"})
            try:
                # After running out of memory, give back what the failed take held.
                state["torch"].cuda.empty_cache()
            except Exception:  # noqa: BLE001
                pass


if __name__ == "__main__":
    main()
