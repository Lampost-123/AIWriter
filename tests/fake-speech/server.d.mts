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
  /** AI Write's speech folder and Breeze's folder: what isn't given above is read from the files there. */
  home?: string
  breezeRoot?: string
  /** The dictation model it starts with (default 'parakeet'). */
  dictationEngine?: 'none' | 'parakeet' | 'whisper'
  /** What the voices run on (default 'CUDA · NVIDIA GeForce RTX 4090'; 'CPU' for the processor). */
  device?: string
  /** How long /health takes to answer, in ms. */
  healthDelayMs?: number
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
