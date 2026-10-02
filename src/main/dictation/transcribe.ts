// Adapted from Poor-Mans-Holodeck's transcription call (server/index.mjs, transcribe()): the recording is
// posted as it is, a WAV, to the speech server's /audio/transcriptions route, which answers { text }.
// Here it goes through speechFetch (this computer only), its answer is tidied (tidy.ts), and every
// problem is said in plain words with the next step. The audio is never written anywhere.
import { DICTATION_MAX_SECONDS } from '@shared/contracts/dictation'
import { UserError } from '../util'
import { speechFetch } from '../speech/client'
import { tidyDictation } from './tidy'

/** The server's own limit on a recording (Holodeck's: 8 MB); four minutes at 16 kHz is about 7.7 MB. */
export const MAX_WAV_BYTES = 8_000_000

/** Writing down four minutes of speech on the processor can take a while. */
const TIMEOUT_MS = 180_000

const WHERE = 'Settings › Read aloud and dictation'

export const NOT_READY = `Dictation isn't ready yet: no dictation model is loaded. Pick Parakeet or Whisper in ${WHERE}.`
export const TOO_LONG = `That recording is longer than the speech engine takes. Keep each one under ${DICTATION_MAX_SECONDS / 60} minutes.`
export const TOO_SLOW = 'The speech engine took too long to write that down. Try again, or try a shorter recording.'
export const FAILED = `The speech engine couldn't write down what you said. Try again; if it keeps happening, check the speech engine in ${WHERE}.`

type Fetcher = (path: string, init: RequestInit & { timeoutMs?: number }) => Promise<Response>

/** True for the start of a WAV file ("RIFF"). */
const isWav = (b: Uint8Array): boolean => b.length >= 44 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46

/** The reason the server gave, from its JSON ({ detail } or { error }) or its text. */
async function reasonOf(res: Response): Promise<string> {
  const text = await res.text().catch(() => '')
  try {
    const body = JSON.parse(text) as { detail?: unknown; error?: unknown }
    return String(body.detail ?? body.error ?? '')
  } catch {
    return text
  }
}

/** Plain words for an answer that isn't the words. */
function failure(status: number, reason: string): UserError {
  if (status === 413) return new UserError(TOO_LONG, 'dictation-too-long')
  if (/no dictation model|not (installed|loaded)/i.test(reason)) return new UserError(NOT_READY, 'dictation-not-ready')
  return new UserError(FAILED, 'dictation-failed')
}

/**
 * What was said in `wav` (16 kHz mono, made in the window), tidied. '' when there was nothing to write
 * down. `fetcher` is speechFetch outside tests.
 */
export async function transcribeWith(fetcher: Fetcher, wav: Uint8Array): Promise<string> {
  if (!isWav(wav) || wav.length <= 44) return ''
  if (wav.length > MAX_WAV_BYTES) throw new UserError(TOO_LONG, 'dictation-too-long')
  const timeout = AbortSignal.timeout(TIMEOUT_MS)
  let res: Response
  try {
    res = await fetcher('/audio/transcriptions', {
      method: 'POST',
      headers: { 'Content-Type': 'audio/wav' },
      body: wav,
      signal: timeout,
      timeoutMs: TIMEOUT_MS
    })
  } catch (e) {
    if (timeout.aborted) throw new UserError(TOO_SLOW, 'dictation-failed')
    throw e
  }
  // "No audio": the server heard nothing worth writing down.
  if (res.status === 400) return ''
  if (!res.ok) throw failure(res.status, await reasonOf(res))
  let body: { text?: unknown }
  try {
    body = (await res.json()) as { text?: unknown }
  } catch {
    if (timeout.aborted) throw new UserError(TOO_SLOW, 'dictation-failed')
    throw new UserError(FAILED, 'dictation-failed')
  }
  return tidyDictation(typeof body.text === 'string' ? body.text : '')
}

/** What was said in a recording, from the speech server set in Settings. */
export const transcribe = (wav: Uint8Array): Promise<string> => transcribeWith(speechFetch, wav)
