// Types for the fake speech server (server.mjs), for the tests that start it.

export interface FakeSpeechOptions {
  /** 0 (any free port) by default. */
  port?: number
  /** Breeze is downloaded there (default true). */
  voices?: boolean
  /** The Read aloud part's way of saying the voices aren't ready. */
  voicesNotReady?: boolean
  /** Each dictation model is downloaded there (default true). */
  parakeet?: boolean
  whisper?: boolean
  /** AI Write's speech folder: what isn't given above is read from the files there. */
  home?: string
  /** The dictation model it starts with (default 'parakeet'). */
  dictationEngine?: 'none' | 'parakeet' | 'whisper'
  /** What the voices run on (default 'CUDA · NVIDIA GeForce RTX 4090'; 'CPU' for the processor). */
  device?: string
  /** How long /health takes to answer, in ms. */
  healthDelayMs?: number
  /** Why the voices fail to load, as the real server reports it ('OutOfMemoryError: CUDA out of memory...'). */
  voicesLoadError?: string
  /** The same for a dictation model. */
  dictationLoadError?: { parakeet?: string; whisper?: string }
  /** The sound effects are downloaded there (default true, or what `home` holds). */
  sounds?: boolean
  /** Why the sound effects fail to load (every sound asked for gets a 503 saying so). */
  soundsLoadError?: string
  /** The voices have the graphics card: every sound asked for gets a 503 with x-sound-retry: 1. */
  soundsBusy?: boolean
  /** Answer every sound asked for with this instead. */
  soundsFail?: { status?: number; detail?: string }
  /** How long making a sound takes, in ms. */
  soundsDelayMs?: number
  /** The sound effects fit beside the voices on the graphics card now (default true). */
  beside?: boolean
  /** The dictation model that times words (/v1/align); by default the first downloaded, Whisper first. null: none. */
  aligner?: 'whisper' | 'parakeet' | null
  /** The words of a clip this server didn't speak, for /v1/align (spread evenly over the clip). */
  alignWords?: string
  /** Refuse what the real server refuses (speech-server/app/guard.py): another Host than this computer, or a request that changes something without AI Write's header or a JSON or audio body. */
  guard?: boolean
  /** Called once the server has stopped after /shutdown. */
  onClose?: () => void
  /** The other parts' options (readAloud.mjs, dictation.mjs). */
  [option: string]: unknown
}

export interface FakeSpeech {
  /** http://127.0.0.1:<port>/v1 */
  url: string
  port: number
  /** Every request so far; `ours` when it carried AI Write's header (X-AIWrite: speech). */
  requests(): { method: string; path: string; bytes: number; ours: boolean }[]
  close(): Promise<void>
}

/** Starts it on 127.0.0.1. The options object is read on every request, so a test can change it as it goes. */
export function startFakeSpeech(options?: FakeSpeechOptions): Promise<FakeSpeech>
