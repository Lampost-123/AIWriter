# Adapted from mcreader-v2, tts/app/workers/breeze.py (Adam's rule, 2 October 2026: only speech code is reused).
"""Breeze TTS 2: a voice from a description or a clip, directed in plain English, with vocal events.

https://github.com/breezeblue-ai/breeze-tts. Its code is not a pip package, so
tools/install.py unpacks a pinned copy into models/breeze/code and this worker
imports it from there (AIWRITE_BREEZE_CODE: AI Write's own copy, in its speech folder).
Weights and self-hosted output are research and non-commercial.

Three things the model takes, and where each comes from:

* The voice. A clip from voices/ (with the words it says in a .txt beside it) is cloned.
  The studio voices (voices/library/, tools/install.py studio-voices) are clips too: real
  people recorded in a studio, each with acted clips of the feelings reading aloud uses.
  A description ("a gravelly man in his sixties, slow and warm") is designed once into
  a clip of its own under voices/breeze/, and every later line clones that clip, with a
  seed fixed per voice: designing afresh for every sentence would give a slightly
  different person each time. The clip is named by the description, so a character keeps
  one voice through the whole book, and across books in the same world, until the
  description changes. The clip's recording (microphone, room, hiss) carries into every
  line, so a voice is designed as a studio recording (STUDIO).
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
# "lively" is a hurried line read a little faster: "briskly" at CFG 5 came out far too fast to listen to (MCreader).
PACE = {"slow": "slowly and deliberately", "lively": "a touch quicker than usual, every word still clear", "fast": "briskly"}
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
# Said after every description a voice is designed from. Left to itself, Breeze picks a recording along with the
# person (a phone line, a far microphone, a hissy tape, a room), and every line copied from the clip sounds the same.
STUDIO = "Recorded close-up on a high-end studio condenser microphone in a treated vocal booth: full, crisp and clear, completely dry, with no room echo and no background noise."
# The feelings reading aloud names (src/main/readAloud/emotion.ts) and the EARS emotion a studio voice acts each
# from (tools/install.py studio-voices saves them). In a blind round on ten lines by four voices, the acted clip beat the calm
# one 33 to 7 and kept the speaker sounding like themselves. Sad lost that round with notes as plain as "with a feeling of
# sad"; with an actor's note it won 2 of 2 blind (MCreader's lab), so sad copies the speaker's sadness clip.
# Neutral lines read from the calm clip.
MOOD_CLIPS = {
    "angry": "anger", "afraid": "fear", "happy": "amusement", "playful": "amusement", "tender": "adoration", "sad": "sadness",
    "contemptuous": "disgust", "surprised": "amazement", "excited": "amazement", "anxious": "distress",
    "tense": "distress", "longing": "disappointment", "warm": "contentment",
    # Not feelings but ways of speaking, read from the same speaker whispering or reading loudly: reading aloud sends
    # these for a hushed line and for a shout (moodFor in src/main/readAloud/emotion.ts).
    "whisper": "whisper", "loud": "loud",
}
# Takes tried for a voice until one says the whole line. Which take sounds best is left to the ear (MCreader's
# redesign tool): over 96 clips rated by ear, no measure (DNSMOS, SQUIM, bandwidth, hiss, room) agreed with the ear
# better than a rank correlation of 0.4, and the takes such a score picked lost to the first seed as often as they won.
DESIGN_TAKES = 3
# How long LINE takes to say, give or take: outside it, a take skipped words or ran on.
LINE_SECONDS = (4.0, 20.0)
# "off" reads with Breeze's plain eager loop, if the CUDA graphs below ever misbehave on a card.
FAST = os.environ.get("AIWRITE_BREEZE_FAST", "on").strip().lower() not in ("0", "off", "no", "false")
# The word check ("Check each line's words" in Settings): a speech recogniser listens back to a new clip, and a clip
# with more of its words wrong than this (a skipped phrase, a repeat, babble) is voiced once more with another seed.
CHECK_MODEL = os.environ.get("AIWRITE_CHECK_MODEL", "distil-whisper/distil-small.en")
CHECK_WER = float(os.environ.get("AIWRITE_CHECK_WER", "0.15"))


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


# Sounds aren't words: Breeze's tags in what was sent, and what a recogniser writes for a laugh ("[laughs]", "(sighs)").
NOT_WORDS = re.compile(r"\([^)]*\)|\[[^\]]*\]")


def words(text: str) -> list[str]:
    """The words of a line, for comparing what was sent with what was heard: no case, no apostrophes, no sounds.

    Numbers are left out: Breeze says "three" for a 3 and a recogniser may write either."""
    t = NOT_WORDS.sub(" ", text).lower().replace("’", "").replace("'", "")
    return [w for w in re.findall(r"[^\W_]+", t) if not any(c.isdigit() for c in w)]


def misheard(said: str, heard: str, norm=None) -> float:
    """The share of the line's words that came out wrong (word error rate), or 0 for a line too short to judge, or
    only one word off (a name the recogniser doesn't know, "okay" heard as "ok"). `norm` is the recogniser's own
    spelling normaliser, run on both sides: it writes "gray" for "grey" and "mister" for "Mr."."""
    if norm is not None:
        said, heard = norm(said), norm(heard)
    a, b = words(said), words(heard)
    if len(a) < 4:
        return 0.0
    prev = list(range(len(b) + 1))
    for i, x in enumerate(a, 1):
        cur = [i] + [0] * len(b)
        for j, y in enumerate(b, 1):
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x != y))
        prev = cur
    errors = prev[-1]
    return errors / len(a) if errors >= 2 else 0.0


def heard(state: dict, audio, sr: int) -> str | None:
    """What the recogniser hears in a clip, or None when it can't listen (it failed to load: clips go unchecked)."""
    if state.get("asr_failed"):
        return None
    if "asr" not in state:
        try:
            import torch
            from transformers import pipeline

            # Downloaded with the studio voices (tools/install.py check-model); the server runs offline, so never here.
            print(f"Breeze: loading the word check ({CHECK_MODEL}).", file=sys.stderr)
            gpu = torch.cuda.is_available()
            state["asr"] = pipeline("automatic-speech-recognition", model=CHECK_MODEL, device=0 if gpu else -1, dtype=torch.float16 if gpu else torch.float32)
        except Exception as exc:  # noqa: BLE001 — no check is better than no reading
            state["asr_failed"] = True
            print(f"Breeze: the word check could not load ({exc}); clips go unchecked until Breeze restarts.", file=sys.stderr)
            return None
    import librosa
    import numpy as np

    x = np.asarray(audio, dtype=np.float32).reshape(-1)
    if sr != 16000:
        x = librosa.resample(x, orig_sr=sr, target_sr=16000).astype(np.float32)
    try:
        out = state["asr"]({"raw": x, "sampling_rate": 16000}, chunk_length_s=30)
    except Exception as exc:  # noqa: BLE001
        print(f"Breeze: the word check failed on a clip ({exc.__class__.__name__}); it plays unchecked.", file=sys.stderr)
        return None
    return str(out.get("text") or "")


def spelling(state: dict):
    """The recogniser's English normaliser (Whisper's: American spelling, "Mr." as "mister"), or None."""
    return getattr(getattr(state.get("asr"), "tokenizer", None), "normalize", None)


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


def design_key(desc: str) -> str:
    """The name a description's clip is saved under."""
    return f"{seed_for(desc):08x}"


def design_seed(desc: str, take: int) -> int:
    """The seed of a description's take; the first is the seed every voice was designed with before takes."""
    return seed_for(desc if take == 0 else f"{desc}|{take}")


def design_take(state: dict, desc: str, take: int):
    """(audio, sr) of one take of a voice: the description as a studio recording (STUDIO), saying LINE."""
    return generate(state, LINE, instruction_text=f"{desc} {STUDIO}", seed=design_seed(desc, take))


def design(state: dict, desc: str) -> None:
    """Design `desc` into its clip under DESIGNS: the first of DESIGN_TAKES takes that says the whole line."""
    for take in range(DESIGN_TAKES):
        audio, sr = design_take(state, desc, take)
        # A take far shorter or longer than the line skipped words or ran on past them.
        if LINE_SECONDS[0] < audio.size / sr < LINE_SECONDS[1]:
            break
        print(f"Breeze: take {take + 1} of voice {design_key(desc)} ran {audio.size / sr:.1f} s; trying another.", file=sys.stderr)
    save_design(desc, audio, sr)


def save_design(desc: str, audio, sr: int) -> None:
    """Save `audio` as the clip a description's voice is cloned from."""
    import soundfile as sf

    key = design_key(desc)
    # Every line is cloned from this clip, so it is saved clean and with headroom (DESIGN_PEAK).
    peak = float(abs(audio).max()) if audio.size else 0.0
    if peak > 0:
        audio = audio * (DESIGN_PEAK / peak)
    # Each written beside and renamed into place, the clip last: a half-written file is never taken for a voice.
    txt, wav, part = DESIGNS / f"{key}.txt", DESIGNS / f"{key}.wav", DESIGNS / f"{key}.part"
    part.write_text(LINE, encoding="utf-8")
    os.replace(part, txt)
    (DESIGNS / f"{key}.description.txt").write_text(desc, encoding="utf-8")
    sf.write(str(part), audio, sr, format="WAV", subtype="PCM_16")
    os.replace(part, wav)


def reference(state: dict, voice: str, params: dict) -> tuple[Path, str]:
    """(clip, the words in it) for this voice: the designed clip for a description (made once), else a clip from voices/.

    A description wins over the picked voice: a character's comes with the narrator's pick still in `voice`, and when
    that pick was a clip, every character read in the narrator's voice.
    """
    if voice.startswith("clip:") and not str(params.get("voice_design") or "").strip():
        clip = (VOICES / voice.split(":", 1)[1]).resolve()
        # A studio library voice (voices/library/<id>.wav) with this line's feeling: the speaker's own acted clip of it
        # (voices/library/<id>/<emotion>.wav), so the line is copied from them already feeling it.
        acted = MOOD_CLIPS.get(str(params.get("mood") or ""))
        if acted and clip.parent == (VOICES / "library").resolve():
            mood_clip = clip.parent / clip.stem / f"{acted}.wav"
            if mood_clip.is_file() and mood_clip.with_suffix(".txt").is_file():
                return mood_clip, mood_clip.with_suffix(".txt").read_text(encoding="utf-8").strip()
        if VOICES.resolve() in clip.parents and clip.is_file():
            side = clip.with_suffix(".txt")
            if not side.is_file():
                raise RuntimeError(f"Breeze copies a voice from a clip only with its words: put what {clip.name} says in {side.name} beside it.")
            said = side.read_text(encoding="utf-8").strip()
            # An empty one reaches Breeze as no words at all ("ref_audio_path and ref_text must be provided together").
            if not said:
                raise RuntimeError(f"Breeze copies a voice from a clip only with its words: {side.name} beside {clip.name} is empty.")
            return clip, said
    desc = design_for(voice, params)
    key = design_key(desc)
    wav, txt = DESIGNS / f"{key}.wav", DESIGNS / f"{key}.txt"
    import soundfile as sf

    # Both files, or the voice is designed again: a clip whose words never got written beside it (Breeze stopped
    # between the two) failed every line in that voice from then on.
    if not (wav.is_file() and txt.is_file()):
        design(state, desc)
    elif key not in state.setdefault("levelled", set()):
        # A clip designed before DESIGN_PEAK (saved at full scale) is turned down once, in place: the same voice, quieter.
        state["levelled"].add(key)
        audio, sr = sf.read(str(wav), dtype="float32")
        peak = float(abs(audio).max()) if audio.size else 0.0
        if peak > DESIGN_PEAK + 0.05:
            part = DESIGNS / f"{key}.part"
            sf.write(str(part), audio * (DESIGN_PEAK / peak), sr, format="WAV", subtype="PCM_16")
            os.replace(part, wav)
            print(f"Breeze: turned the designed voice {wav.name} down from peak {peak:.2f} to {DESIGN_PEAK}.", file=sys.stderr)
    return wav, txt.read_text(encoding="utf-8").strip()


def synth(state, text: str, voice: str, speed: float, params: dict):
    ref = reference(state, voice or "", params)
    t0 = time.perf_counter()
    cfg = GENTLE_CFG if params.get("gentle") else CFG

    def voiced(key: str):
        audio, sr = generate(state, spoken(text), instruction_text=instruction(params, text), ref=ref, seed=seed_for(key), cfg=cfg)
        return trim_stray_tail(audio, sr), sr

    # The voice is the clip; the seed only picks among the ways it could say this line, so each line has its own
    # rather than every line of a voice sharing one. The same line still comes back the same, unless it is asked for
    # as another take (the reader redid it).
    take = max(0, int(params.get("take") or 0))
    key = f"{ref[0].name}|{text}" + (f"|{take}" if take else "")
    audio, sr = voiced(key)
    if params.get("check"):
        said = heard(state, audio, sr)
        wrong = misheard(text, said, spelling(state)) if said is not None else 0.0
        if wrong > CHECK_WER:
            again, sr2 = voiced(f"{key}|again")
            said2 = heard(state, again, sr2)
            wrong2 = misheard(text, said2, spelling(state)) if said2 is not None else 1.0
            print(f"Breeze: the word check heard {wrong:.0%} of a line wrong; the second take {wrong2:.0%}.", file=sys.stderr)
            if wrong2 < wrong:
                audio, sr = again, sr2
    took, secs = time.perf_counter() - t0, audio.size / sr
    # Under 1 keeps up with reading aloud; above it, the reader waits between sentences. Samples at full scale were
    # clamped by the codec: more than a few, and the line crackles.
    clipped = float((abs(audio) >= 0.999).mean()) if audio.size else 0.0
    peak = float(abs(audio).max()) if audio.size else 0.0
    print(f"Breeze: {secs:.1f} s of audio in {took:.1f} s (x{took / max(secs, 0.01):.2f} real time), peak {peak:.2f}, {clipped:.2%} clipped.", file=sys.stderr)
    return audio, sr


if __name__ == "__main__":
    serve(load, synth)
