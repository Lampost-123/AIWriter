// Talking to the local speech server from the main process (milestone 4). Reading aloud and dictation
// call its routes through speechFetch (mcreader-v2's routes, plus Holodeck's /audio/transcriptions), so
// the address and its "this computer only" rule live in one place. Owned by the Speech engine part,
// which may change what happens inside but keeps this signature.
import { getSettings } from '../settings'
import { UserError } from '../util'
import { isStarting, whenStarted } from './starting'
import { speechUrl } from './url'

/** Plain words for "the speech server isn't answering". */
export const SPEECH_NOT_RUNNING =
  "The speech engine isn't running. Start it in Settings › Read aloud and dictation, or check it there if it should be running."

/** Waits for `p`, or until `signal` aborts (then rejects with the reason). */
function until(p: Promise<void>, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(signal.reason)
  return new Promise((resolve, reject) => {
    const stop = (): void => reject(signal.reason)
    signal.addEventListener('abort', stop, { once: true })
    p.then(() => {
      signal.removeEventListener('abort', stop)
      resolve()
    })
  })
}

/**
 * A request to one of the speech server's routes ('/audio/speech', '/voices'...), on this computer only.
 * Gives up after `timeoutMs` (default 60 s) or when `signal` aborts. A server that can't be reached is a
 * UserError (code 'speech-not-running') with plain words; any answer, an error status included, is returned.
 * While AI Write is starting the server, a request waits for it (within its time) and is sent again once.
 */
export async function speechFetch(path: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<Response> {
  const { timeoutMs = 60_000, signal, ...rest } = init
  const timeout = AbortSignal.timeout(timeoutMs)
  const both = signal ? AbortSignal.any([signal, timeout]) : timeout
  const send = (): Promise<Response> => fetch(speechUrl(getSettings().speech?.serverUrl, path), { ...rest, signal: both })
  try {
    return await send()
  } catch (e) {
    if (signal?.aborted) throw e
    if (isStarting() && !both.aborted) {
      try {
        await until(whenStarted(), both)
        return await send()
      } catch (again) {
        if (signal?.aborted) throw again
      }
    }
    throw new UserError(SPEECH_NOT_RUNNING, 'speech-not-running')
  }
}
