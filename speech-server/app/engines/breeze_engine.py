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

# The weights, as MCreader names them, so its copy on this computer can be used as it is.
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
    return downloaded.breeze_complete(config.BREEZE_ROOT, own=downloaded.same_folder(config.BREEZE_ROOT, config.HOME))


class BreezeEngine(WorkerEngine):
    id = "breeze"
    name = "Breeze TTS 2"
    blurb = "Makes a voice from a description, clones clips, and performs tags like (laugh) and (sigh). Graphics card, about 8 GB. Non-commercial licence."
    worker = "breeze"

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
        return out
