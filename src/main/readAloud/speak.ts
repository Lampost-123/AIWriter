// Adapted from mcreader-v2, src/server/speech/speak.ts (reading aloud's own text-to-speech code; Adam's rule,
// 2 October 2026). MCreader's web route is an IPC call here (ipc/readAloud.ts), and the speech server is reached
// through speechFetch (src/main/speech/client.ts), on this computer only.
//
// One clip: from the disk cache when it was spoken before, else from the speech server's `POST /v1/audio/speech`
// (the same request MCreader sends), then kept. The same clip asked for twice at once (a clip prepared ahead, then
// played) is spoken once.
import type { ClipRequest } from '@shared/contracts/readAloud'
import { speechFetch } from '../speech/client'
import { UserError } from '../util'
import { AudioCache } from './audioCache'

/** The body sent to the speech server's OpenAI-style `POST /v1/audio/speech`. */
export interface SpeechPayload {
  model?: string
  input: string
  voice?: string
  speed: number
  response_format: 'wav'
  instruct?: string
  sfx?: boolean
  pace?: string
  voice_design?: string
  delivery?: string
  gentle?: boolean
}

/** Plain words for the speech server answering that it can't speak yet (the voices aren't downloaded, or won't load). */
export const VOICES_NOT_READY =
  "The voices aren't ready yet. Download them, or check the speech engine, in Settings › Read aloud and dictation."
/** Plain words for a line the speech server turned down or couldn't make. */
export const SPEECH_FAILED =
  "The voice couldn't read this line. Try again; if it keeps happening, check the speech engine in Settings › Read aloud and dictation."

/**
 * What the server is asked to say for a clip. The server speaks at its own pace (`speed` 1): the player changes the
 * speed, which keeps the pitch and sounds cleaner than stretching the audio.
 */
export function speechPayload(clip: ClipRequest, engine = 'breeze'): SpeechPayload {
  const payload: SpeechPayload = {
    model: engine || undefined,
    input: clip.input,
    voice: clip.voice || undefined,
    speed: 1,
    response_format: 'wav'
  }
  if (clip.instruct) payload.instruct = clip.instruct
  if (clip.sounds) payload.sfx = true
  if (clip.pace) payload.pace = clip.pace
  // The voice made from a description (a character's, or the narrator's), and the note for this line.
  if (clip.voiceDesign) payload.voice_design = clip.voiceDesign
  if (clip.delivery) payload.delivery = clip.delivery
  // Narration read with its note, held close to the narrator's voice.
  if (clip.gentle) payload.gentle = true
  return payload
}

/** The key a clip is kept under: the request as sent, so the same words in the same voice are spoken once. */
export const clipKey = (clip: ClipRequest, engine = 'breeze'): string => AudioCache.keyOf({ payload: speechPayload(clip, engine), v: 1 })

export type Fetcher = (path: string, init: RequestInit & { timeoutMs?: number }) => Promise<Response>

const inflight = new Map<string, Promise<Buffer>>()

/** One clip's audio, from `cache` when it was spoken before. Throws a plain-words UserError when it can't be had. */
export async function speak(clip: ClipRequest, cache: AudioCache, engine = 'breeze', fetcher: Fetcher = speechFetch): Promise<Buffer> {
  if (!clip.input.trim()) throw new UserError('There are no words to read there.')
  const key = clipKey(clip, engine)
  const hit = await cache.get(key)
  if (hit) return hit
  let pending = inflight.get(key)
  if (!pending) {
    pending = synthesise(speechPayload(clip, engine), fetcher).then(async (audio) => {
      await cache.put(key, audio).catch((e) => console.warn('[read aloud] could not keep a clip', e))
      return audio
    })
    inflight.set(key, pending)
    void pending.finally(() => inflight.delete(key)).catch(() => undefined)
  }
  return pending
}

async function synthesise(payload: SpeechPayload, fetcher: Fetcher): Promise<Buffer> {
  const res = await fetcher('/audio/speech', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    timeoutMs: 180_000
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    console.warn(`[read aloud] the speech server answered ${res.status}: ${detail.slice(0, 300)}`)
    if (res.status === 503 || res.status === 404) throw new UserError(VOICES_NOT_READY, 'voices-not-ready')
    throw new UserError(SPEECH_FAILED, 'speech-failed')
  }
  const audio = Buffer.from(await res.arrayBuffer())
  // A WAV header alone is 44 bytes: anything less isn't a clip.
  if (audio.length <= 44) throw new UserError(SPEECH_FAILED, 'speech-failed')
  return audio
}
