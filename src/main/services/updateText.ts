import type { UpdateStatus } from '@shared/types'

// Plain-words text for the updater, kept free of Electron so it can be unit-tested.

export const UPDATES_NOT_SET_UP = "Automatic updates aren't set up yet. Download new versions from GitHub."
export const UPDATES_DEV_ONLY = 'Automatic updates only run in the installed app.'
export const UPDATES_BY_HAND = 'To update, download the newest installer from GitHub and run it. Your worlds, settings and keys are kept.'
const OFFLINE = "Couldn't reach GitHub to check for updates. Check your internet connection, then try again."
const BAD_DOWNLOAD = "The update didn't download properly. AI Write will try again the next time it starts."
const OTHER = "Couldn't check for updates just now. Try again later, or download the latest version from GitHub."

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" }

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+|#39);/gi, (m, code: string) => {
    const lower = code.toLowerCase()
    if (lower in ENTITIES) return ENTITIES[lower]
    if (lower.startsWith('#x')) return String.fromCodePoint(parseInt(lower.slice(2), 16))
    if (lower.startsWith('#')) return String.fromCodePoint(parseInt(lower.slice(1), 10))
    return m
  })
}

/** Turns release notes (HTML or Markdown from GitHub, or a list of notes) into a short plain-text note. */
export function releaseNotesText(notes: string | { version?: string; note?: string | null }[] | null | undefined, max = 600): string {
  const raw = Array.isArray(notes) ? notes.map((n) => n.note ?? '').join('\n') : (notes ?? '')
  let t = raw
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n• ')
    .replace(/<\/(p|div|li|ul|ol|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
  t = decodeEntities(t)
    .replace(/^\s*#{1,6}\s*/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '• ')
    .replace(/\*\*(.+?)\*\*|__(.+?)__/g, (_m, a: string, b: string) => a ?? b)
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
  t = t
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
  if (t.length > max) t = t.slice(0, max).replace(/\s+\S*$/, '') + '…'
  return t
}

/**
 * Maps an updater error to a status. A private or empty releases page answers 404/401, which
 * means updates aren't set up yet: that's 'disabled', not an error to worry about.
 */
export function describeUpdateError(err: unknown): UpdateStatus {
  const e = (err ?? {}) as { message?: unknown; code?: unknown; statusCode?: unknown }
  const message = typeof e.message === 'string' ? e.message : String(err)
  const code = typeof e.code === 'string' ? e.code : ''
  const status = typeof e.statusCode === 'number' ? e.statusCode : null
  const text = `${code} ${message}`

  if (status !== null && [401, 403, 404, 406, 410].includes(status)) return { state: 'disabled', message: UPDATES_NOT_SET_UP }
  // electron-updater wraps a dropped connection in its "can't find the latest version" errors,
  // so check for a network problem before reading those as "not set up".
  if (/ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNREFUSED|ECONNRESET|ENETUNREACH|EHOSTUNREACH|net::ERR_|socket hang up|getaddrinfo|timed out/i.test(text)) {
    return { state: 'error', message: OFFLINE }
  }
  if (
    (status === null && /\b(401|403|404|406|410)\b/.test(text)) ||
    /authentication token|no published versions|unable to find latest version|cannot find latest|latest version not found|channel file|app-update\.yml|ERR_UPDATER_(LATEST_VERSION_NOT_FOUND|NO_PUBLISHED_VERSIONS|CHANNEL_FILE_NOT_FOUND|INVALID_RELEASE_FEED)/i.test(
      text
    )
  ) {
    return { state: 'disabled', message: UPDATES_NOT_SET_UP }
  }
  if (/sha512|checksum|signature|ERR_UPDATER_INVALID_SIGNATURE|not signed/i.test(text)) {
    return { state: 'error', message: BAD_DOWNLOAD }
  }
  return { state: 'error', message: OTHER }
}
