// Adapted from mcreader-v2, src/lib/speech/settings.ts (SpeechVoice) and src/components/speech/SpeechSettings.tsx
// (voiceMeta) (reading aloud's own text-to-speech code; Adam's rule, 2 October 2026). MCreader's settings page read
// the list through its web route; here it comes over IPC from the speech server's `GET /v1/voices`.
import type { ReadAloudVoice } from '@shared/contracts/readAloud'
import { speechFetch } from '../speech/client'
import { UserError } from '../util'
import { VOICES_NOT_READY } from './speak'
import type { Fetcher } from './speak'

/** One voice as the speech server lists it: Breeze's presets are "designed"; Adam's own clips are `clip:<file>`. */
interface ServerVoice {
  id?: unknown
  name?: unknown
  engine?: unknown
  gender?: unknown
  traits?: unknown
  recommended?: unknown
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

/** "female · warm, measured" reads better than the raw fields. */
function aboutOf(v: ServerVoice, clip: boolean): string {
  const traits = str(v.traits)
    .replace(/^designed · /, '')
    .replace(/^your clip(?: · )?/i, '')
  return [clip ? 'Your own clip' : str(v.gender), traits].filter(Boolean).join(' · ')
}

/** The voices of one engine in a server's list, as Settings shows them. */
export function voicesFrom(list: unknown, engine: string): ReadAloudVoice[] {
  const rows = Array.isArray(list) ? (list as ServerVoice[]) : []
  const seen = new Set<string>()
  return rows.flatMap((v) => {
    const id = str(v?.id)
    if (!id || seen.has(id) || (str(v.engine) && str(v.engine) !== engine)) return []
    seen.add(id)
    const clip = id.startsWith('clip:')
    return [{ id, name: str(v.name) || id.replace(/^clip:/, ''), about: aboutOf(v, clip), clip, recommended: v.recommended === true }]
  })
}

/** The voices the speech server offers for an engine. Plain-words errors when it isn't running or can't list them. */
export async function listVoices(engine: string, fetcher: Fetcher = speechFetch): Promise<ReadAloudVoice[]> {
  const res = await fetcher(`/voices?engine=${encodeURIComponent(engine)}`, { timeoutMs: 15_000 })
  if (res.status === 404 || res.status === 503) throw new UserError(VOICES_NOT_READY, 'voices-not-ready')
  if (!res.ok)
    throw new UserError("The speech engine couldn't list its voices. Check it in Settings › Read aloud and dictation.", 'speech-failed')
  return voicesFrom(await res.json().catch(() => []), engine)
}
