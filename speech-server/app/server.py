# Adapted from mcreader-v2, tts/app/server.py, with Poor-Mans-Holodeck's transcription route from its
# tts/app/server.py (Adam's rule, 2 October 2026: only speech code is reused).
"""The HTTP surface AI Write talks to (from its main process; the window never calls it).

MCreader's routes, with the same requests and replies:

* `/v1/audio/speech` — the OpenAI speech API (and `/speak`, the same thing).
* `/v1/health`, `/v1/voices`, `/v1/models` — which engine is installed and loaded, the device, the voices.
* `/v1/warmup`, `/v1/unload`, `/shutdown` — load an engine now, give the memory back, stop.

Poor Man's Holodeck's dictation: `/v1/audio/transcriptions` takes a WAV clip and answers `{"text": ...}`.
AI Write's own: `/v1/dictation` says which dictation engine is chosen and loaded, and picks another.

Everything is bound to this computer and holds no credentials, so requests are not authenticated;
nothing here should ever be exposed to a network. A web page open in a browser on this computer can't
drive it either: `guard.Guard` checks every request's Host header, and takes a request that changes
something only from a program that means to send it (AI Write's header, or a JSON or audio body).
"""

import asyncio
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
from .engines import EngineError
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


def _unload_everything() -> list[str]:
    done = []
    for engine in engine_pool.all_engines():
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
