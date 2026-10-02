// Talking to the local speech server from the main process (milestone 4). Reading aloud and dictation
// call its routes through speechFetch (mcreader-v2's routes, plus Holodeck's /audio/transcriptions), so
// the address and its "this computer only" rule live in one place. Owned by the Speech engine part,
// which may change what happens inside but keeps this signature.
import { getSettings } from '../settings'
import { UserError } from '../util'
import { speechUrl } from './url'

/** Plain words for "the speech server isn't answering". */
export const SPEECH_NOT_RUNNING =
  "The speech engine isn't running. Start it in Settings › Read aloud and dictation, or check it there if it should be running."

/**
 * A request to one of the speech server's routes ('/audio/speech', '/voices'...), on this computer only.
 * Gives up after `timeoutMs` (default 60 s) or when `signal` aborts. A server that can't be reached is a
 * UserError (code 'speech-not-running') with plain words; any answer, an error status included, is returned.
 */
export async function speechFetch(path: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<Response> {
  const { timeoutMs = 60_000, signal, ...rest } = init
  const timeout = AbortSignal.timeout(timeoutMs)
  const both = signal ? AbortSignal.any([signal, timeout]) : timeout
  try {
    return await fetch(speechUrl(getSettings().speech?.serverUrl, path), { ...rest, signal: both })
  } catch (e) {
    if (signal?.aborted) throw e
    throw new UserError(SPEECH_NOT_RUNNING, 'speech-not-running')
  }
}
