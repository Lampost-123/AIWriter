# Adapted from mcreader-v2, tts/app/engines/breeze_engine.py (Adam's rule, 2 October 2026: only speech code is reused).
"""Breeze TTS 2, run in venvs/breeze by app/workers/breeze.py.

Research and non-commercial licence for the weights and anything they speak: fine for
hearing your own manuscript, not for audio you sell.
"""

from .. import config, downloaded
from ..config import VOICES
from .worker_engine import WorkerEngine

# The clip types a voice can be copied from.
AUDIO_SUFFIXES = {".wav", ".mp3", ".flac", ".ogg", ".m4a", ".opus"}

# The weights' name on Hugging Face.
REPO = downloaded.BREEZE_REPO

# id, name, gender, traits. The descriptions they are made from are in workers/breeze.py.
PRESETS = [
    ("narrator", "Narrator", "", "warm, clear, unhurried", True),
    ("narrator-deep", "Deep narrator", "male", "resonant, measured, a little gravel", False),
    ("narrator-bright", "Bright narrator", "female", "articulate, warm, crisp", False),
    ("young-woman", "Young woman", "female", "light, lively", False),
    ("young-man", "Young man", "male", "easy, casual", False),
    ("old-man", "Old man", "male", "thin, slow, thoughtful", False),
    ("old-woman", "Old woman", "female", "soft, papery, sharp-witted", False),
    ("child", "Child", "", "small, clear, eager", False),
]


def weights_downloaded() -> bool:
    """All of the weights are here, so Breeze can load offline: AI Write's own copy once its download checked
    out (it leaves a mark), MCreader's when every file looks whole. A download stopped part way never counts."""
    return downloaded.breeze_complete(config.BREEZE_ROOT)


class BreezeEngine(WorkerEngine):
    id = "breeze"
    name = "Breeze TTS 2"
    blurb = "Makes a voice from a description, clones clips, and performs tags like (laugh) and (sigh). Graphics card, about 9.5 GB. Non-commercial licence."
    worker = "breeze"
    # Measured on an RTX 5070 Ti (nvidia-smi, the whole worker): about 9460 MiB once loaded (its CUDA graphs captured),
    # 9480 at most while speaking.
    needs_mb = 9700
    holds_mb = 9500
    # The voices come first: the sound effects wait for them, and are let go when the voices need the room.
    priority = 1
    wait_reason = "is reading aloud now. The sound is made once it has finished."

    def _available(self) -> tuple[bool, str]:
        ok, why = super()._available()
        if not ok:
            return ok, why
        if not (config.BREEZE_CODE / "breeze_infer").is_dir() or not weights_downloaded():
            return False, "Only partly downloaded. Download the voices again in AI Write's Settings, Read aloud and dictation."
        return True, ""

    def _voices(self) -> list[dict]:
        out = [{
            "id": vid, "name": name, "engine": self.id, "lang": "en", "language": "English", "accent": "",
            "gender": gender, "grade": "", "traits": f"designed · {traits}", "recommended": rec,
        } for vid, name, gender, traits, rec in PRESETS]
        if VOICES.exists():
            for p in sorted(VOICES.iterdir()):
                # Breeze needs the words said in the clip, so only clips with a .txt beside them.
                if p.is_file() and p.suffix.lower() in AUDIO_SUFFIXES and p.with_suffix(".txt").is_file():
                    out.append({
                        "id": f"clip:{p.name}", "name": p.stem.replace("_", " ").replace("-", " ").strip() or p.name,
                        "engine": self.id, "lang": "en", "language": "English", "accent": "", "gender": "",
                        "grade": "", "traits": f"your clip · {p.name}", "recommended": False,
                    })
        return out + library_voices()


def library_voices() -> list[dict]:
    """The studio voices (tools/install.py studio-voices): real people recorded in a studio, listed as
    "Clara · Woman, 26-35 · mid voice (studio)", once their download has finished (its mark is there). Then Adam's
    own voices made in MCreader's voice studio, brought over into the same folder and listed in custom.json
    ("Mira · Woman, 34 · mid voice (your voice)"), which need no download. Then the voices MCreader designed from
    descriptions, brought over into voices/mcreader/, each named by the start of its description."""
    import json
    import re

    library = VOICES / "library"
    lists = [("custom.json", True)]
    if downloaded.studio_complete(config.HOME):
        lists.insert(0, ("index.json", False))
    out, seen = [], set()
    for name, own in lists:
        try:
            listed = json.loads((library / name).read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        for v in listed if isinstance(listed, list) else []:
            vid = v.get("id") if isinstance(v, dict) else None
            if not isinstance(vid, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,40}", vid) or vid in seen:
                continue
            if not ((library / f"{vid}.wav").is_file() and (library / f"{vid}.txt").is_file()):
                continue
            seen.add(vid)
            who = "Woman" if v.get("gender") == "female" else "Man"
            # A voice made in the voice studio has an exact age as well as its band.
            age = str(v["years"]) if v.get("years") else str(v.get("age", ""))
            pitch = v.get("pitch", "mid")
            made = "your voice" if own else "studio"
            out.append({
                "id": f"clip:library/{vid}.wav", "name": f"{v.get('name') or vid} · {who}, {age} · {pitch} voice ({made})",
                "engine": "breeze", "lang": "en", "language": "English", "accent": "", "gender": v.get("gender", ""),
                "grade": "", "traits": f"{made if own else 'studio recording'} · {age} · {pitch} pitch", "recommended": False,
                "age": v.get("age", ""), "pitch": pitch, "studio": True, **({"own": True} if own else {}),
            })
    return out + mcreader_voices()


def mcreader_voices() -> list[dict]:
    """The voices MCreader designed from descriptions, brought over into voices/mcreader/ (Adam, 7 October 2026):
    "From MCreader · A gravelly man in his sixties…", by the start of the description each was made from."""
    folder = VOICES / "mcreader"
    if not folder.is_dir():
        return []
    out = []
    for wav in sorted(folder.glob("*.wav")):
        if not wav.with_suffix(".txt").is_file():
            continue
        try:
            about = (folder / f"{wav.stem}.description.txt").read_text(encoding="utf-8").strip()
        except OSError:
            about = ""
        short = " ".join(about.split()[:8]) + ("…" if len(about.split()) > 8 else "")
        out.append({
            "id": f"clip:mcreader/{wav.name}", "name": f"From MCreader · {short or wav.stem}",
            "engine": "breeze", "lang": "en", "language": "English", "accent": "", "gender": "",
            "grade": "", "traits": f"your voice · {about[:200]}" if about else "your voice", "recommended": False, "own": True,
        })
    return out
