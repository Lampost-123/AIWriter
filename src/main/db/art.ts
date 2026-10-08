// SQL for the desk's drawing choices (UI overhaul, D5.4; contract src/shared/contracts/art.ts): one JSON value in the
// world's `meta`, like the relationship map's layout (worldViews.ts). Choices for entries or stories that are gone are
// left out when read and dropped when written, so the value never grows with leftovers.
import type Database from 'better-sqlite3'
import type { ArtChoices, StoryCoverChoice } from '@shared/contracts/art'
import { motifById } from '@shared/motifs'
import type { ID } from '@shared/types'
import { getMeta, setMeta } from './repo'

type DB = Database.Database

/** The `meta` key holding Adam's drawing and cover choices. */
export const ART_KEY = 'art_choices'

const live = (db: DB, table: 'entries' | 'stories'): Set<ID> =>
  new Set((db.prepare(`SELECT id FROM ${table} WHERE deleted_at IS NULL`).all() as { id: ID }[]).map((r) => r.id))

const hueOf = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? ((Math.round(v) % 360) + 360) % 360 : undefined)

/** Reads what is saved, keeping only well-formed choices for live entries and stories. */
export function readArtChoices(db: DB): ArtChoices {
  let saved: unknown
  try {
    saved = JSON.parse(getMeta(db, ART_KEY) ?? 'null')
  } catch {
    saved = null
  }
  const out: ArtChoices = { entries: {}, stories: {} }
  if (!saved || typeof saved !== 'object') return out
  const s = saved as { entries?: Record<string, unknown>; stories?: Record<string, unknown> }
  const entries = live(db, 'entries')
  const stories = live(db, 'stories')
  for (const [id, v] of Object.entries(s.entries ?? {})) {
    const c = v as { motif?: unknown; by?: unknown }
    if (!entries.has(id) || typeof c?.motif !== 'string' || !motifById(c.motif)) continue
    out.entries[id] = { motif: c.motif, by: c.by === 'ai' ? 'ai' : 'adam' }
  }
  for (const [id, v] of Object.entries(s.stories ?? {})) {
    const c = v as { motif?: unknown; hue?: unknown }
    if (!stories.has(id) || !c || typeof c !== 'object') continue
    const choice: StoryCoverChoice = {}
    if (typeof c.motif === 'string' && motifById(c.motif)) choice.motif = c.motif
    const hue = hueOf(c.hue)
    if (hue !== undefined) choice.hue = hue
    if (choice.motif || choice.hue !== undefined) out.stories[id] = choice
  }
  return out
}

function write(db: DB, choices: ArtChoices): ArtChoices {
  setMeta(db, ART_KEY, JSON.stringify(choices))
  return choices
}

/** Chooses an entry's drawing, or (null) goes back to the one its words call for. */
export function setEntryMotif(db: DB, entryId: ID, motif: string | null, by: 'adam' | 'ai' = 'adam'): ArtChoices {
  if (motif !== null && !motifById(motif)) throw new Error('That drawing isn’t in the library.')
  const now = readArtChoices(db)
  if (motif && live(db, 'entries').has(entryId)) now.entries[entryId] = { motif, by }
  else delete now.entries[entryId]
  return write(db, now)
}

/** Chooses a story's cover (its drawing, its colour), or (null) goes back to its own. */
export function setStoryCover(db: DB, storyId: ID, cover: StoryCoverChoice | null): ArtChoices {
  if (cover?.motif && !motifById(cover.motif)) throw new Error('That drawing isn’t in the library.')
  const now = readArtChoices(db)
  const choice: StoryCoverChoice = {}
  if (cover?.motif) choice.motif = cover.motif
  const hue = hueOf(cover?.hue)
  if (hue !== undefined) choice.hue = hue
  if ((choice.motif || choice.hue !== undefined) && live(db, 'stories').has(storyId)) now.stories[storyId] = choice
  else delete now.stories[storyId]
  return write(db, now)
}
