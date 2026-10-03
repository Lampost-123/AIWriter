// Adam's sounds (AI sound effects under Read aloud): what he adds, changes or removes in the Sounds view, kept in the
// world's meta key `sounds` (SoundEdits by scene id), so they travel with the world and its backups. A paragraph whose
// sounds he changed is his: the AI's sounds there are kept as his first, and the AI never marks it again. Removing
// the last sound leaves the paragraph his, with none.
import type Database from 'better-sqlite3'
import type { CueAnchor, CueInput, SceneCue, SoundCue, SoundEdits, SoundKind } from '@shared/contracts/sounds'
import type { ID } from '@shared/types'
import * as repo from '../db/repo'
import { UserError } from '../util'
import { keptCue, relocate, type Paragraph } from './scene'

type DB = Database.Database

export const META_KEY = 'sounds'

/** Room for a description, and for an anchor's words. */
const MAX_DESCRIPTION = 120
const MAX_WORDS = 200
const SAFE = /^[A-Za-z0-9_:.-]{1,80}$/

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '')
const int = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0)

function anchorOf(v: unknown): CueAnchor | null {
  if (!v || typeof v !== 'object') return null
  const a = v as Record<string, unknown>
  const pid = str(a.pid, 40)
  if (!pid) return null
  const from = int(a.from)
  return { pid, from, to: Math.max(from, int(a.to)), words: str(a.words, MAX_WORDS) }
}

const kindOf = (v: unknown): SoundKind | null => (v === 'effect' || v === 'ambience' ? v : null)

function cueOf(v: unknown): SoundCue | null {
  if (!v || typeof v !== 'object') return null
  const c = v as Record<string, unknown>
  const kind = kindOf(c.kind)
  const at = anchorOf(c.at)
  const id = str(c.id, 80)
  const description = str(c.description, MAX_DESCRIPTION).trim()
  if (!kind || !at || !SAFE.test(id) || !description) return null
  return keptCue({ id, kind, description, soundId: '', at, until: kind === 'ambience' ? anchorOf(c.until) : undefined, origin: 'adam' })
}

/** One scene's edits as they may be kept: anything unreadable is left out. */
export function cleanEdits(v: unknown): SoundEdits {
  const owned: Record<string, SoundCue[]> = {}
  const o = (v as { owned?: unknown })?.owned
  if (o && typeof o === 'object') {
    for (const [pid, cues] of Object.entries(o as Record<string, unknown>).slice(0, 5000)) {
      if (!pid || pid.length > 40 || !Array.isArray(cues)) continue
      owned[pid] = cues
        .slice(0, 100)
        .map(cueOf)
        .filter((c): c is SoundCue => !!c && c.at.pid === pid)
    }
  }
  return { owned }
}

function readAll(db: DB): Record<string, unknown> {
  try {
    const v = JSON.parse(repo.getMeta(db, META_KEY) ?? '{}') as unknown
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/** A scene's edits (none: nothing owned). */
export function sceneEdits(db: DB, sceneId: ID): SoundEdits {
  return cleanEdits(readAll(db)[sceneId])
}

/** Keeps a scene's edits (none owned: the scene's entry goes), and tells backups the world changed. */
export function saveSceneEdits(db: DB, sceneId: ID, edits: SoundEdits): void {
  const all = readAll(db)
  if (Object.keys(edits.owned).length) all[sceneId] = edits
  else delete all[sceneId]
  repo.setMeta(db, META_KEY, JSON.stringify(all))
  repo.touchWorld(db)
}

/** An anchor Adam placed, checked against its paragraph's words now. */
function placedIn(paragraphs: ReadonlyMap<string, Paragraph>, a: CueAnchor | null): CueAnchor {
  const p = a ? paragraphs.get(a.pid) : undefined
  if (!a || !p) throw new UserError(`That place isn't in the scene any more. Try again.`)
  const from = Math.min(a.from, p.text.length)
  const to = Math.min(Math.max(from, a.to), p.text.length)
  if (to > from) return { pid: a.pid, from, to, words: p.text.slice(from, to) }
  // Only words to go by: found nearest where they were said to be.
  return relocate(p.text, { pid: a.pid, from, to, words: a.words }).anchor
}

/** A cue from the Sounds view, checked: its kind, description and places in the scene's words now. */
export function cueInputOf(v: unknown, paragraphs: readonly Paragraph[]): CueInput {
  const c = (v ?? {}) as Record<string, unknown>
  const kind = kindOf(c.kind)
  const description = str(c.description, MAX_DESCRIPTION).trim().replace(/\s+/g, ' ')
  if (!kind) throw new UserError('Choose whether it is a sound effect or ambience.')
  if (!description) throw new UserError('Describe the sound first, in a few words.')
  const byPid = new Map(paragraphs.map((p) => [p.pid, p]))
  const at = placedIn(byPid, anchorOf(c.at))
  let until: CueAnchor | null = null
  if (kind === 'ambience' && c.until) {
    const u = placedIn(byPid, anchorOf(c.until))
    const order = paragraphs.map((p) => p.pid)
    const after = order.indexOf(u.pid) > order.indexOf(at.pid) || (u.pid === at.pid && u.from > at.from)
    // An end before its start: it plays on until the next ambience.
    until = after ? u : null
  }
  return { kind, description, at, ...(kind === 'ambience' ? { until } : {}) }
}

/**
 * Adam's change to a scene's sounds: adds (`cueId` null), changes, or removes (`cue` null) one. The paragraph a cue
 * starts in (and, when it moves, the one it leaves) becomes his: the AI's sounds there are copied in as his first,
 * keeping their ids, then the change is made. Pure: returns the scene's new edits.
 */
export function editCue(o: {
  edits: SoundEdits
  /** The scene's sounds as they stand (sceneCues). */
  cues: readonly SceneCue[]
  cueId: string | null
  cue: CueInput | null
  newId: () => string
}): SoundEdits {
  const owned: Record<string, SoundCue[]> = Object.fromEntries(Object.entries(o.edits.owned).map(([pid, cs]) => [pid, [...cs]]))
  const own = (pid: string): SoundCue[] =>
    (owned[pid] ??= o.cues.filter((c) => c.origin === 'ai' && c.at.pid === pid).map((c) => keptCue({ ...c, origin: 'adam' })))
  const old = o.cueId === null ? null : o.cues.find((c) => c.id === o.cueId)
  if (o.cueId !== null && !old) throw new UserError("That sound isn't there any more. Try again.")
  let id = old?.id ?? `adam:${o.newId()}`
  if (old) {
    const list = own(old.at.pid)
    const i = list.findIndex((c) => c.id === old.id)
    if (i >= 0) list.splice(i, 1)
  }
  if (o.cue) {
    // An id is used once in a scene.
    if (!old && o.cues.some((c) => c.id === id)) id = `adam:${o.newId()}`
    const list = own(o.cue.at.pid)
    const cue = keptCue({
      id,
      kind: o.cue.kind,
      description: o.cue.description,
      soundId: '',
      at: o.cue.at,
      ...(o.cue.kind === 'ambience' ? { until: o.cue.until ?? null } : {}),
      origin: 'adam'
    })
    list.push(cue)
    list.sort((a, b) => a.at.from - b.at.from)
  }
  return { owned }
}
