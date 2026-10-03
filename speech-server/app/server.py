# Adapted from mcreader-v2, tts/app/server.py, with Poor-Mans-Holodeck's transcription route from its
# tts/app/server.py (Adam's rule, 2 October 2026: only speech code is reused).
"""The HTTP surface AI Write talks to (from its main process; the window never calls it).

MCreader's routes, with the same requests and replies:

* `/v1/audio/speech` — the OpenAI speech API (and `/speak`, the same thing).
* `/v1/health`, `/v1/voices`, `/v1/models` — which engine is installed and loaded, the device, the voices.
* `/v1/warmup`, `/v1/unload`, `/shutdown` — load an engine now, give the memory back, stop.

Poor Man's Holodeck's dictation: `/v1/audio/transcriptions` takes a WAV clip and answers `{"text": ...}`.
AI Write's own: `/v1/dictation` says which dictation engine is chosen and loaded, and picks another;
`/v1/sounds/generate` makes one sound effect (Stable Audio Open, app/engines/sound_engine.py); `/v1/align` says
when each word of a spoken clip is heard (with a dictation model), so a sound fires on its word.

Everything is bound to this computer and holds no credentials, so requests are not authenticated;
nothing here should ever be exposed to a network. A web page open in a browser on this computer can't
drive it either: `guard.Guard` checks every request's Host header, and takes a request that changes
something only from a program that means to send it (AI Write's header, or a JSON or audio body).
"""

import asyncio
import io
import os
import tempfile
import threading
import time
import traceback
from contextlib import asynccontextmanager

from fastapi import Body, FastAPI, HTTPException, Query, Request
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, ConfigDict

from . import __version__
from . import config
from . import engines as engine_pool
from . import stt
from .audio import SAMPLE_RATE, tail_silence, to_wav
from .engines import EngineBusy, EngineError
from .engines.sound_engine import KINDS as SOUND_KINDS, clamp_seconds, clamp_takes
from .guard import Guard
from .lifeline import end_with

MAX_CHARS = 4000
# Poor Man's Holodeck's limit: about four minutes of 16 kHz mono 16-bit audio.
MAX_CLIP_BYTES = 8_000_000
STARTED = time.time()
# What Adam reads when dictation fails in a way the engines don't explain (the details go to the log).
DICTATION_FAILED = (
    "Dictation couldn’t hear that clip. Try again; if it keeps happening, pick the other model in Settings › Read aloud and dictation."
)
LOAD_FAILED = (
    "That dictation model couldn’t be loaded. Download it again in Settings › Read aloud and dictation, or pick the other one."
)
# The longest description a sound is made from.
MAX_SOUND_PROMPT = 300
SOUND_FAILED = "The sound couldn’t be made. Try again; if it keeps happening, restart the speech engine."
ALIGN_FAILED = "The words in that clip couldn’t be timed."


def _unload_everything() -> list[str]:
    done = []
    for engine in engine_pool.every_engine():
        if engine.loaded:
            try:
                engine.unload()
                done.append(engine.id)
            except Exception:  # noqa: BLE001 - giving the memory back anyway
                pass
    if stt.unload():
        done.append("dictation")
    return done


def _preload() -> None:
    """The chosen dictation engine first (it is quick and Adam may dictate at once), then any voice engines."""
    picked = config.dictation()
    if picked != "none":
        try:
            stt.use(picked)
        except Exception as exc:  # noqa: BLE001 - /v1/health says it isn't loaded
            print(f"Dictation: could not load {picked}: {exc}", flush=True)
    engine_pool.warmup()


@asynccontextmanager
async def lifespan(_: FastAPI):
    """Load what was asked for and start the idle unloaders.

    The models are loaded on a thread rather than here: `/v1/health` has to answer
    straight away so AI Write can show "Starting" instead of timing out.
    """
    end_with(config.parent_pid(), before_exit=_unload_everything)
    stt.pick(config.dictation())
    engine_pool.start_idle_watch()
    stt.start_idle_watch()
    threading.Thread(target=_preload, name="preload", daemon=True).start()
    yield


app = FastAPI(
    title="AI Write speech",
    version=__version__,
    description="Reading aloud and dictation for AI Write, on this computer only.",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
    lifespan=lifespan,
)
# Only programs on this computer that mean to talk to it (guard.py).
app.add_middleware(Guard)


class SpeechBody(BaseModel):
    """`/speak` and `/v1/audio/speech` share one body; `input` is the OpenAI name."""

    model_config = ConfigDict(extra="allow")

    text: str | None = None
    input: str | None = None
    voice: str | None = None
    model: str | None = None
    engine: str | None = None
    speed: float | None = None
    lang: str | None = None
    response_format: str | None = None
    exaggeration: float | None = None
    cfg_weight: float | None = None
    temperature: float | None = None
    sentence_pause: float | None = None
    clause_pause: float | None = None
    # Delivery. `instruct` is a standing style in plain English; `emotion`/`pace` are per-passage direction.
    instruct: str | None = None
    emotion: str | None = None
    pace: str | None = None
    sfx: bool | None = None
    # Breeze: the voice made from this description, and this line's own delivery note.
    voice_design: str | None = None
    delivery: str | None = None
    # Breeze: narration read with its note, but held close to the voice (a lower CFG).
    gentle: bool | None = None

    def payload(self) -> str:
        return (self.text if self.text is not None else self.input) or ""

    def params(self) -> dict:
        out = {}
        for name in ("lang", "exaggeration", "cfg_weight", "temperature", "sentence_pause", "clause_pause", "instruct", "emotion", "pace", "sfx", "voice_design", "delivery", "gentle"):
            value = getattr(self, name)
            if value is not None:
                out["sentencePause" if name == "sentence_pause" else "clausePause" if name == "clause_pause" else name] = value
        return out


def _engine_for(body: SpeechBody):
    """`engine` wins, then `model` (the OpenAI field), then the best one installed."""
    named = body.engine or body.model
    try:
        return engine_pool.get(named) if named else engine_pool.default_engine()
    except EngineError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def _synthesize(body: SpeechBody) -> Response:
    text = body.payload().strip()
    if not text:
        raise HTTPException(status_code=400, detail="No text to read.")
    if len(text) > MAX_CHARS:
        raise HTTPException(
            status_code=413,
            detail=f"That is {len(text)} characters; send it in pieces of {MAX_CHARS} or fewer.",
        )
    engine = _engine_for(body)
    speed = 1.0 if body.speed is None else body.speed
    try:
        samples, sr = engine.synth(text, body.voice or "", speed, body.params())
    except EngineError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    if sr != SAMPLE_RATE:
        # The worker resamples itself; this is the last line of defence.
        raise HTTPException(status_code=500, detail=f"{engine.name} returned {sr} Hz audio.")
    return Response(
        content=to_wav(samples, sr, tail=tail_silence(text)),
        media_type="audio/wav",
        headers={
            "x-tts-engine": engine.id,
            "x-tts-voice": body.voice or "",
            "cache-control": "no-store",
        },
    )


def _dictation() -> dict:
    return {"engine": stt.choice(), "loaded": stt.loaded(), "models": stt.statuses()}


# --- what AI Write asks about ----------------------------------------------


@app.get("/health")
@app.get("/v1/health")
def health() -> dict:
    engines = engine_pool.statuses()
    return {
        "ok": True,
        "service": "aiwrite-speech",
        "version": __version__,
        "app": os.environ.get("AIWRITE_APP_VERSION", ""),
        "uptime": round(time.time() - STARTED, 1),
        "sampleRate": SAMPLE_RATE,
        "device": engine_pool.device_label(),
        "default": engine_pool.default_engine().id,
        "engines": engines,
        "ready": any(e["ready"] for e in engines),
        "dictation": _dictation(),
        # The sound effects (not a voice engine): {ready, loaded, detail, loadError, beside}. `beside`: they can sit
        # beside the voices on the graphics card now (both loaded, or the one that isn't would fit).
        "sounds": engine_pool.sounds_status(),
        # The dictation model that times the words of a spoken clip (/v1/align), or None when none is downloaded.
        "aligner": stt.aligner(),
    }


@app.get("/voices")
@app.get("/v1/voices")
def voices(engine: str | None = Query(default=None)) -> list[dict]:
    try:
        return engine_pool.voices(engine)
    except EngineError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.get("/v1/models")
def models() -> dict:
    return {
        "object": "list",
        "data": [
            {"id": e["id"], "object": "model", "owned_by": "aiwrite-speech", "name": e["name"]}
            for e in engine_pool.statuses()
            if e["ready"]
        ],
    }


# --- the actual work -----------------------------------------------------


@app.post("/speak")
def speak(body: SpeechBody) -> Response:
    return _synthesize(body)


@app.post("/v1/audio/speech")
def openai_speech(body: SpeechBody = Body(...)) -> Response:
    return _synthesize(body)


@app.post("/v1/audio/transcriptions")
async def transcribe(request: Request) -> dict:
    """A WAV clip. Dictation never leaves this machine, and the clip is deleted as soon as it is heard."""
    data = await request.body()
    if len(data) < 44:
        raise HTTPException(400, "No audio.")
    if len(data) > MAX_CLIP_BYTES:
        raise HTTPException(413, "That recording is too long. Stop sooner and try again.")

    def run() -> str:
        handle = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
        handle.write(data)
        handle.close()
        try:
            return stt.transcribe(handle.name)
        finally:
            os.remove(handle.name)

    try:
        text = await asyncio.to_thread(run)
    except stt.DictationError as exc:
        # Already in plain words.
        raise HTTPException(503, str(exc)) from exc
    except ImportError:
        raise HTTPException(
            503,
            "That dictation model is not installed. In Settings, Read aloud and dictation, download it or pick the other one.",
        )
    except Exception as exc:  # noqa: BLE001 — AI Write shows the answer to Adam: plain words, the details in the log
        print("Dictation failed:", flush=True)
        traceback.print_exc()
        raise HTTPException(503, DICTATION_FAILED) from exc
    return {"text": text}


class SoundBody(BaseModel):
    """One sound: what it is, an effect or ambience, how long (clamped), how many takes CLAP picks from, the seed."""

    prompt: str = ""
    kind: str = "effect"
    seconds: float | None = None
    takes: int | None = None
    seed: int | None = None


def _sound_wav(samples, sr: int) -> bytes:
    import soundfile as sf

    buf = io.BytesIO()
    sf.write(buf, samples, sr, format="WAV", subtype="PCM_16")
    return buf.getvalue()


@app.post("/v1/sounds/generate")
async def make_sound(body: SoundBody) -> Response:
    """One sound effect or ambience as a 44.1 kHz stereo WAV; one at a time (the others wait).

    400 for a request it can't make sense of. 503 with plain words when the sound effects aren't downloaded, can't
    load, or can't run now; `x-sound-retry: 1` on a 503 means it will likely work later (the voices had the graphics
    card), so AI Write tries again then.
    """
    prompt = (body.prompt or "").strip()
    if not prompt:
        raise HTTPException(400, "Say what the sound is.")
    if len(prompt) > MAX_SOUND_PROMPT:
        raise HTTPException(400, f"That description is {len(prompt)} characters; keep it to {MAX_SOUND_PROMPT} or fewer.")
    kind = (body.kind or "effect").strip().lower()
    if kind not in SOUND_KINDS:
        raise HTTPException(400, "A sound is an effect or ambience.")
    seconds = clamp_seconds(kind, body.seconds)
    takes = clamp_takes(body.takes)
    seed = None if body.seed is None else int(body.seed) % 2**32
    engine = engine_pool.sound()
    ok, why = engine.available()
    if not ok:
        raise HTTPException(503, why)
    try:
        made = await asyncio.to_thread(engine.make, prompt, kind, seconds, takes, seed)
    except EngineBusy as exc:
        raise HTTPException(503, str(exc), headers={"x-sound-retry": "1"}) from exc
    except EngineError as exc:
        raise HTTPException(503, str(exc)) from exc
    except Exception as exc:  # noqa: BLE001 — plain words for AI Write, the details in the log
        print("Sound effects failed:", flush=True)
        traceback.print_exc()
        raise HTTPException(503, SOUND_FAILED) from exc
    return Response(
        content=_sound_wav(made["samples"], made["sr"]),
        media_type="audio/wav",
        headers={
            "x-sound-score": f"{made['score']:.4f}",
            "x-sound-seconds": f"{made['seconds']:.3f}",
            "cache-control": "no-store",
        },
    )


@app.post("/v1/align")
async def align(request: Request) -> dict:
    """A spoken clip (WAV) → when each word is heard: {"words": [{"word", "start", "end"}], "engine"}. The clip is
    deleted as soon as it is heard. 503 "no-aligner" when no dictation model is downloaded; 503 "busy" (with
    `x-align-retry: 1`) while dictation is using the model, which always goes first."""
    data = await request.body()
    if len(data) < 44:
        raise HTTPException(400, "No audio.")
    if len(data) > MAX_CLIP_BYTES:
        raise HTTPException(413, "That clip is too long to time its words.")
    if stt.aligner() is None:
        raise HTTPException(503, "no-aligner")

    def run() -> tuple[list[dict], str]:
        handle = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
        handle.write(data)
        handle.close()
        try:
            return stt.align(handle.name)
        finally:
            os.remove(handle.name)

    try:
        words, engine = await asyncio.to_thread(run)
    except stt.AlignBusy as exc:
        # Dictation goes first; AI Write places the sounds by an estimate meanwhile.
        raise HTTPException(503, "busy", headers={"x-align-retry": "1"}) from exc
    except stt.DictationError as exc:
        raise HTTPException(503, "no-aligner") from exc
    except Exception as exc:  # noqa: BLE001 — the details in the log
        print("Timing the words failed:", flush=True)
        traceback.print_exc()
        raise HTTPException(503, ALIGN_FAILED) from exc
    return {"words": words, "engine": engine}


@app.get("/v1/dictation")
def dictation_state() -> dict:
    return _dictation()


@app.post("/v1/dictation")
async def dictation_pick(body: dict = Body(default={})) -> dict:
    """Load Parakeet, load Whisper, or drop both ("none"). The voices are left alone."""
    engine = str((body or {}).get("engine") or "none")
    try:
        await asyncio.to_thread(stt.use, engine)
    except stt.DictationError as exc:
        # Already in plain words.
        raise HTTPException(503, str(exc)) from exc
    except Exception as exc:  # noqa: BLE001 — plain words for Settings, the details in the log
        print(f"Dictation: could not load {engine}:", flush=True)
        traceback.print_exc()
        raise HTTPException(503, LOAD_FAILED) from exc
    return _dictation()


@app.post("/warmup")
@app.post("/v1/warmup")
async def warmup(body: dict = Body(default={})) -> dict:
    """Load voice engines in the background; reading aloud calls this when it is turned on."""
    wanted = body.get("engines") if isinstance(body, dict) else None
    if isinstance(wanted, str):
        wanted = [wanted]
    result = await asyncio.to_thread(engine_pool.warmup, wanted)
    return {"ok": True, "engines": result}


@app.post("/unload")
@app.post("/v1/unload")
async def unload() -> dict:
    """Give the memory back without stopping the server. Each model loads again when next asked."""
    return {"ok": True, "unloaded": await asyncio.to_thread(_unload_everything)}


@app.post("/shutdown")
@app.post("/v1/shutdown")
async def shutdown(request: Request) -> dict:
    """Stop the server; AI Write calls this when "Start with AI Write" goes off.

    Only a JSON request is taken: a page on another site cannot send one without a
    CORS preflight, which it fails, so it cannot switch the server off.
    """
    if "application/json" not in request.headers.get("content-type", ""):
        raise HTTPException(status_code=415, detail="Send an application/json request.")

    def run() -> None:
        # Unloading stops the Breeze worker process along with its graphics card memory.
        _unload_everything()
        os._exit(0)

    # After the reply is sent, so AI Write hears that it worked.
    threading.Timer(0.3, run).start()
    return {"ok": True}


@app.exception_handler(EngineError)
def _engine_error(_: Request, exc: EngineError) -> JSONResponse:
    return JSONResponse(status_code=503, content={"error": str(exc)})
