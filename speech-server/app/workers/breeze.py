# Adapted from mcreader-v2, tts/app/workers/breeze.py (Adam's rule, 2 October 2026: only speech code is reused).
"""Breeze TTS 2: a voice from a description or a clip, directed in plain English, with vocal events.

https://github.com/breezeblue-ai/breeze-tts. Its code is not a pip package, so
tools/install.py unpacks a pinned copy into models/breeze/code and this worker
imports it from there (AIWRITE_BREEZE_CODE: AI Write's copy, or MCreader's).
Weights and self-hosted output are research and non-commercial.

Three things the model takes, and where each comes from:

* The voice. A clip from voices/ (with the words it says in a .txt beside it) is cloned.
  A description ("a gravelly man in his sixties, slow and warm") is designed once into
  a clip of its own under voices/breeze/, and every later line clones that clip, with a
  seed fixed per voice: designing afresh for every sentence would give a slightly
  different person each time. The clip is named by the description, so a character keeps
  one voice through the whole book, and across books in the same world, until the
  description changes.
* An instruction: the standing style, plus the delivery the performer wrote for this
  line ("hushed, close to tears"), plus the older director's emotion and pace.
* Vocal events inline in the text, in parentheses, spelled as the breeze-tts README spells them: (laugh), (sigh), (clears throat).
  Reading aloud writes those before the text gets here.
"""

import gc
import os
import re
import sys
import time
import zlib
from pathlib import Path

from ..audio import trim_stray_tail
from ._common import serve

# Where the server says things are (app/engines/worker_engine.py passes them in).
CODE = Path(os.environ.get("AIWRITE_BREEZE_CODE", "") or Path.home() / ".aiwrite-speech" / "models" / "breeze" / "code")
VOICES = Path(os.environ.get("AIWRITE_SPEECH_VOICES", "") or Path.home() / ".aiwrite-speech" / "voices")
# Designed voices live with the voice clips, not with the weights.
DESIGNS = VOICES / "breeze"
REPO = os.environ.get("AIWRITE_BREEZE_MODEL", "BreezeBlue/breeze-tts-2")

# What a designed voice says in its clip; the same line the Qwen VoiceDesign presets speak.
LINE = (
    "I found the letter under the floorboard where she said it would be, and I read it twice "
    "before I understood what it meant. Then I put it back, and I did not tell anyone."
)
DEFAULT_DESIGN = "A seasoned audiobook narrator with a warm, clear, mid-range voice and an unhurried, natural delivery."

# The presets in the voice list, by id. BreezeEngine lists the same ids.
PRESETS = {
    "narrator": DEFAULT_DESIGN,
    "narrator-deep": "A deep, resonant male narrator in his fifties, calm and measured, with a slight gravel to the voice.",
    "narrator-bright": "A bright, articulate female narrator in her thirties, warm and expressive, with crisp diction.",
    "young-woman": "A young woman in her twenties with a light, lively voice and a quick, natural way of speaking.",
    "young-man": "A young man in his twenties with an easy, casual voice, relaxed and friendly.",
    "old-man": "An old man in his seventies with a thin, slightly cracked voice, slow and thoughtful.",
    "old-woman": "An elderly woman with a soft, papery voice, kind but sharp-witted, speaking slowly.",
    "child": "A ten-year-old child with a small, clear, eager voice.",
}

# The model's README gives CFG 4 to strengthen instruction-following. One more: in MCreader's test scene, 5 put
# back the pitch movement the calmer 4 lost, with the voices as much themselves as at 4, and performed a line's
# sounds that 4 dropped. It also follows an extreme note all the way ("barely above a whisper" came out a whisper).
# Without an instruction the template has no negative prompt, so plain cloning runs at 1.
CFG = float(os.environ.get("AIWRITE_BREEZE_CFG", "5"))
# Narration with the writer's note while the narrator is kept steady: one below the lines, and above the 1 to 2
# Breeze's prompting guide starts narration at. At 2 the author heard the notes too little ("still flat").
GENTLE_CFG = float(os.environ.get("AIWRITE_BREEZE_NARRATION_CFG", "4"))
PACE = {"slow": "slowly and deliberately", "fast": "briskly"}
# A delivery that already tells the voice what to do; anything else ("coldly, barely above a whisper") is
# put as "Say it ...", the form Breeze's own guide writes its performance notes in. "Start ... At '...', shift to"
# is narration that turns partway through the clip; "Put clear emphasis on" is a word set in italics.
DIRECTS = re.compile(r"^(say|speak|read|whisper|shout|yell|mutter|murmur|deliver|sound|call|plead|sing|use|keep|make|start|begin|put|let)\b", re.I)
# The vocal events a line has, named the way the Voice Direction benchmark's instructions name them. Its lines
# carry an event both inline and in the instruction ("Produce a sigh before speaking"), so ours do too.
EVENT = re.compile(r"\((laugh|chuckle|giggle|cry|sob|whimper|groan|moan|sigh|gasp|inhale|exhale|breathe heavily|scream|hum|clears throat|cough|sniff|smack lips|click tongue|yawn|sneeze|hiccup|gulp|grunt|scoff|snort)\)")
EVENT_NAMES = {"breathe heavily": "heavy breathing", "clears throat": "throat clearing", "smack lips": "lip smack", "click tongue": "tongue click", "cry": "crying"}
# The level a designed voice clip is saved at. Every line cloned from it follows its loudness, and the
# codec clamps at full scale, so a loud clip makes the loud words of every line after it crackle.
DESIGN_PEAK = 0.6
# "off" reads with Breeze's plain eager loop, if the CUDA graphs below ever misbehave on a card.
FAST = os.environ.get("AIWRITE_BREEZE_FAST", "on").strip().lower() not in ("0", "off", "no", "false")


def events(text: str) -> str:
    """The note that has the events in `text` heard ("Make the sigh and the moan audible where they are written."), or ""."""
    names: list[str] = []
    for m in EVENT.finditer(text):
        name = EVENT_NAMES.get(m.group(1), m.group(1))
        if name not in names:
            names.append(name)
    if not names:
        return ""
    said = " and ".join(f"the {n}" for n in names[:3])
    return f"Make {said} audible where {'they are' if len(names) > 1 else 'it is'} written."


def instruction(params: dict, text: str = "") -> str:
    """The standing style, this line's delivery, and the director's emotion and pace, as one note."""
    delivery = str(params.get("delivery") or "").strip()
    if delivery and not DIRECTS.match(delivery):
        delivery = f"Say it {delivery}"
    parts = [str(params.get("instruct") or "").strip(), delivery]
    emotion = str(params.get("emotion") or "").strip().replace("_", " ")
    pace = PACE.get(str(params.get("pace") or "").strip().lower())
    if emotion or pace:
        bits = [f"with a feeling of {emotion}" if emotion else "", pace or ""]
        parts.append("Read this " + " and ".join(b for b in bits if b) + ".")
    out = " ".join(p.rstrip(".") + "." for p in parts if p)
    # Only on a directed line: an event alone does not turn plain cloning into Voice Direction.
    if out and (said := events(text)):
        out = f"{out} {said}"
    # The hosted API caps instructions at 1,000 characters; stay well inside it.
    return out[:600]


def design_for(voice: str, params: dict) -> str:
    """The description a voice is made from, when it is not a clip."""
    own = str(params.get("voice_design") or "").strip()
    if own:
        return own
    return PRESETS.get((voice or "").strip().lower(), DEFAULT_DESIGN)


# A clip that ends on a comma, semicolon or colon ("I don't know," before "she said") leaves the model expecting more
# words, and it can start one: heard in an audiobook as a click or a cut-off syllable at the end of the line.
OPEN_END = re.compile(r"\s*[,;:]+\s*$")


def spoken(text: str) -> str:
    """The words as the model reads them: a clip ends as a finished sentence."""
    return OPEN_END.sub(".", text)


def seed_for(key: str) -> int:
    return zlib.crc32(key.encode("utf-8")) & 0x7FFFFFFF


def graphs_without_compile() -> None:
    """Breeze's own CUDA graphs for the two loops that run once per audio frame, minus torch.compile.

    Eagerly, each frame of audio is well over a thousand small GPU kernels, one launch at a time; on Windows
    each launch costs more, so the card sits well under half busy however fast it is. A CUDA graph replays a
    whole step as one launch. Breeze turns these on with --fast-backbone-decode and --fast-depth-decoder;
    the second also compiles the depth decoder with torch.compile, which needs Triton, and PyTorch ships
    no Triton for Windows. So the depth decoder is captured as it is: the same loop, uncompiled.
    """
    import models.fast_streaming as fs

    base = fs.DepthDecoderGraph
    if getattr(base, "_aiwrite", False):
        return

    class DepthGraph(base):
        _aiwrite = True

        def __init__(self, *args, **kwargs):
            super().__init__(*args, **{**kwargs, "fast": False})

    fs.DepthDecoderGraph = DepthGraph


def reference_codes_once() -> None:
    """Encode a voice's clip once, not on every line (twice with CFG: the prompt and its negative)."""
    from breeze_infer import templates

    encode = templates._encode_prompt_audio
    seen: dict[tuple[str, int], object] = {}

    def cached(codec, path):
        p = Path(path)
        key = (str(p.resolve()), p.stat().st_mtime_ns)
        if key not in seen:
            if len(seen) >= 64:
                seen.clear()
            seen[key] = encode(codec, path)
        return seen[key]

    templates._encode_prompt_audio = cached


def make_runtime(state: dict, fast: bool):
    from models.fast_streaming import FastBreezeStreamingRuntime, FastStreamingConfig

    config = FastStreamingConfig(
        max_new_tokens=1500, max_seq_len=2048, repetition_penalty=1.1,
        fast_backbone_decode=fast, fast_depth_decoder=fast,
    )
    return FastBreezeStreamingRuntime(state["model"], state["codec"], config, tokenizer=state["tok"])


def load():
    if not (CODE / "breeze_infer").is_dir():
        raise RuntimeError("Breeze's code is missing; download the voices again in Settings, Read aloud and dictation.")
    # Before the cwd: this folder has a models/ of its own (the weights), and Breeze's
    # `models` package has to win the import.
    sys.path.insert(0, str(CODE))

    import numpy as np
    import torch
    from huggingface_hub import snapshot_download

    from breeze_infer.runtime import load_runtime, resolve_device, update_generation_config_for_breeze

    gpu = torch.cuda.is_available()
    if not gpu:
        print("Breeze: no GPU visible; this will be far too slow on the CPU.", file=sys.stderr)
    # From the copy on this computer only: the server runs offline (HF_HUB_OFFLINE), so this never downloads.
    ckpt = Path(snapshot_download(REPO))
    tokenizer, model, audio_tokenizer = load_runtime(ckpt, device=resolve_device(), attn_implementation="eager")
    update_generation_config_for_breeze(model)
    reference_codes_once()
    state = {"tok": tokenizer, "model": model, "codec": audio_tokenizer}
    DESIGNS.mkdir(parents=True, exist_ok=True)

    if gpu and FAST:
        graphs_without_compile()
        try:
            state["runtime"] = make_runtime(state, True)
            # Capture both shapes now (plain and with CFG), not in the middle of the first page read,
            # and make sure what comes out is sound.
            for note in ("", "Calm and even."):
                t0 = time.perf_counter()
                audio, sr = generate(state, "One, two, three.", instruction_text=note)
                if not (0.2 * sr < audio.size < 20 * sr and np.isfinite(audio).all()):
                    raise RuntimeError(f"a {audio.size / sr:.1f} s test clip")
                print(f"Breeze: CUDA graphs ready ({'CFG' if note else 'plain'}: {time.perf_counter() - t0:.1f} s with capture).", file=sys.stderr)
            return state
        except Exception as exc:  # noqa: BLE001 — any failure here means reading without graphs, not not reading
            print(f"Breeze: the fast path failed ({exc}); reading without it. AIWRITE_BREEZE_FAST=off skips trying.", file=sys.stderr)
            state.pop("runtime", None)
        # Outside the except: its traceback would keep the half-built graphs alive.
        gc.collect()
        torch.cuda.empty_cache()
    state["runtime"] = make_runtime(state, False)
    return state


def generate(state: dict, text: str, *, instruction_text: str = "", ref: tuple[Path, str] | None = None, seed: int = 42, cfg: float = CFG):
    import numpy as np

    from breeze_infer.templates import get_template, prepare_inputs, select_template_name

    request = {"id": "aiwrite", "text": text, "speaker": "S0"}
    if instruction_text:
        request["instruction"] = instruction_text
    if ref is not None:
        request["ref_audio_path"] = str(ref[0])
        request["ref_text"] = ref[1]
    inputs = prepare_inputs(
        state["tok"], state["codec"], state["model"], [request], get_template(select_template_name(request)),
        guidance_scale=cfg if instruction_text else 1.0, guidance_scale_ref=None, guidance_scale_ins=None,
    )
    runtime = state["runtime"]
    chunks = [np.asarray(c.audio, dtype=np.float32).reshape(-1) for c in runtime.iter_audio_chunks(inputs, seed=seed)]
    audio = np.concatenate(chunks) if chunks else np.zeros(0, dtype=np.float32)
    return audio, int(runtime.sample_rate)


def reference(state: dict, voice: str, params: dict) -> tuple[Path, str]:
    """(clip, the words in it) for this voice: the designed clip for a description (made once), else a clip from voices/.

    A description wins over the picked voice: a character's comes with the narrator's pick still in `voice`, and when
    that pick was a clip, every character read in the narrator's voice.
    """
    if voice.startswith("clip:") and not str(params.get("voice_design") or "").strip():
        clip = (VOICES / voice.split(":", 1)[1]).resolve()
        if VOICES.resolve() in clip.parents and clip.is_file():
            side = clip.with_suffix(".txt")
            if not side.is_file():
                raise RuntimeError(f"Breeze copies a voice from a clip only with its words: put what {clip.name} says in {side.name} beside it.")
            return clip, side.read_text(encoding="utf-8").strip()
    desc = design_for(voice, params)
    key = f"{seed_for(desc):08x}"
    wav, txt = DESIGNS / f"{key}.wav", DESIGNS / f"{key}.txt"
    import soundfile as sf

    if not wav.is_file():
        print(f"Breeze: designing a voice — {desc}", file=sys.stderr)
        audio, sr = generate(state, LINE, instruction_text=desc, seed=seed_for(desc))
        # Every line is cloned from this clip, so it is saved clean and with headroom (DESIGN_PEAK).
        peak = float(abs(audio).max()) if audio.size else 0.0
        if peak > 0:
            audio = audio * (DESIGN_PEAK / peak)
        sf.write(str(wav), audio, sr, subtype="PCM_16")
        txt.write_text(LINE, encoding="utf-8")
        (DESIGNS / f"{key}.description.txt").write_text(desc, encoding="utf-8")
    elif key not in state.setdefault("levelled", set()):
        # A clip designed before DESIGN_PEAK (saved at full scale) is turned down once, in place: the same voice, quieter.
        state["levelled"].add(key)
        audio, sr = sf.read(str(wav), dtype="float32")
        peak = float(abs(audio).max()) if audio.size else 0.0
        if peak > DESIGN_PEAK + 0.05:
            sf.write(str(wav), audio * (DESIGN_PEAK / peak), sr, subtype="PCM_16")
            print(f"Breeze: turned the designed voice {wav.name} down from peak {peak:.2f} to {DESIGN_PEAK}.", file=sys.stderr)
    return wav, txt.read_text(encoding="utf-8").strip()


def synth(state, text: str, voice: str, speed: float, params: dict):
    ref = reference(state, voice or "", params)
    t0 = time.perf_counter()
    cfg = GENTLE_CFG if params.get("gentle") else CFG
    # The voice is the clip; the seed only picks among the ways it could say this line, so each line has its own
    # rather than every line of a voice sharing one. The same line still comes back the same.
    audio, sr = generate(state, spoken(text), instruction_text=instruction(params, text), ref=ref, seed=seed_for(f"{ref[0].name}|{text}"), cfg=cfg)
    audio = trim_stray_tail(audio, sr)
    took, secs = time.perf_counter() - t0, audio.size / sr
    # Under 1 keeps up with reading aloud; above it, the reader waits between sentences. Samples at full scale were
    # clamped by the codec: more than a few, and the line crackles.
    clipped = float((abs(audio) >= 0.999).mean()) if audio.size else 0.0
    peak = float(abs(audio).max()) if audio.size else 0.0
    print(f"Breeze: {secs:.1f} s of audio in {took:.1f} s (x{took / max(secs, 0.01):.2f} real time), peak {peak:.2f}, {clipped:.2%} clipped.", file=sys.stderr)
    return audio, sr


if __name__ == "__main__":
    serve(load, synth)
