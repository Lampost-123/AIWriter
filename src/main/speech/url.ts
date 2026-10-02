// Where the speech server is: the address in Settings › Read aloud and dictation, which must be on this
// computer (localhost, 127.0.0.1 or ::1), so no text or audio ever leaves it. Pure; reading aloud and
// dictation reach the server through speechUrl().
import { SPEECH_SERVER_URL } from '@shared/defaults'

/** True for an http(s) address on this computer only. */
export function isLoopbackUrl(url: string): boolean {
  try {
    const u = new URL(url)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
    const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase()
    return host === 'localhost' || host === '127.0.0.1' || host === '::1'
  } catch {
    return false
  }
}

/** The server's base address (ending in /v1, no slash after): the one set when it is on this computer, else AI Write's own. */
export function speechBase(serverUrl: string | null | undefined): string {
  const url = (serverUrl ?? '').trim().replace(/\/+$/, '')
  return url && isLoopbackUrl(url) ? url : SPEECH_SERVER_URL
}

/** The address of one of the server's endpoints: speechUrl(settings.speech.serverUrl, '/audio/speech'). */
export const speechUrl = (serverUrl: string | null | undefined, path: string): string =>
  `${speechBase(serverUrl)}${path.startsWith('/') ? path : `/${path}`}`
