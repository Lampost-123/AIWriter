// What the page and the scene panel need about a scene's people, places and things (milestone 3):
// every entry's names for the underlines, and each entry as of the end of the scene for the hover
// cards, the Cast tab and the entry beside the page. One read of the memory for the whole scene, so
// hovering over a name never asks the main process anything. No Electron imports.
import type Database from 'better-sqlite3'
import type { EntryState, ID } from '@shared/types'
import type { NamedEntry, SceneNames, StateLine, VoiceNotes } from '@shared/contracts/manuscript'
import { FIELD_GROUPS } from '@shared/fields'
import { memoryAt } from '../memory/asOf'
import { storyOfScene } from '../memory/line'
import { loadMemoryData, loadShape } from '../memory/scene'
import { sceneCast } from '../db/manuscript'
import { clip, upperFirst } from '../keeper/text'
import { UserError } from '../util'

type DB = Database.Database

/** The newest things that happened to an entry that a card has room for. */
export const HAPPENED_SHOWN = 4
/** The fields set by changes that a card has room for. */
export const FIELDS_SHOWN = 4
/** Sample lines of dialogue sent for a character. */
export const SAMPLE_LINES = 3

/** The voice fields, shown as voice notes rather than as changed fields. */
const VOICE_KEYS = new Set(['speech', 'tics', 'neverSays', 'sampleLines'])

/** Same words as an entry page's as-of view (memory/asOf.ts). */
export const ABSENT = 'Not in the story yet at this point'

const oneLine = (s: string): string => s.replace(/\s+/g, ' ').trim()

function fieldLabel(kind: EntryState['kind'], key: string): string | null {
  for (const g of FIELD_GROUPS[kind] ?? []) for (const f of g.fields) if (f.key === key) return f.label
  return null
}

/**
 * An entry's state as a few plain lines: the last few things that happened to it (oldest first, each
 * with where, marked when it happened in this scene), then the fields a change has set ("Hair: cropped
 * short"). The description, one-liner and voice fields are shown elsewhere, so they aren't repeated.
 */
export function stateLines(e: Pick<EntryState, 'kind' | 'happened' | 'changed' | 'fields'>, hereIds: Set<ID>): StateLine[] {
  const lines: StateLine[] = e.happened
    .filter((h) => h.note.trim())
    .slice(-HAPPENED_SHOWN)
    .map((h): StateLine => {
      const text = upperFirst(oneLine(h.note).replace(/\.$/, ''))
      return { kind: 'happened', text, where: h.where, here: hereIds.has(h.changeId) }
    })
  let fields = 0
  for (const key of e.changed) {
    if (fields >= FIELDS_SHOWN) break
    if (VOICE_KEYS.has(key)) continue
    const label = fieldLabel(e.kind, key)
    const value = oneLine(e.fields[key] ?? '')
    if (!label || !value) continue
    lines.push({ kind: 'field', text: `${label}: ${clip(value, 16)}`, where: '', here: false })
    fields++
  }
  return lines
}

/** A sample line without quotation marks of its own (the interface adds them) or a list mark. */
const sampleLine = (s: string): string => {
  const t = s.trim().replace(/^[-•*]\s+/, '')
  const m = /^["“'‘](.*)["”'’]$/s.exec(t)
  return (m ? m[1] : t).trim()
}

/** A character's voice notes, or null when none are written down. */
export function voiceNotes(e: Pick<EntryState, 'kind' | 'fields'>): VoiceNotes | null {
  if (e.kind !== 'character') return null
  const f = e.fields
  const v: VoiceNotes = {
    speech: oneLine(f.speech ?? ''),
    tics: oneLine(f.tics ?? ''),
    neverSays: oneLine(f.neverSays ?? ''),
    sampleLines: (f.sampleLines ?? '').split(/\r?\n/).map(sampleLine).filter(Boolean).slice(0, SAMPLE_LINES)
  }
  return v.speech || v.tics || v.neverSays || v.sampleLines.length ? v : null
}

function namedEntry(e: EntryState, absent: string | null, hereIds: Set<ID>): NamedEntry {
  return {
    id: e.id,
    kind: e.kind,
    name: e.name,
    aliases: e.aliases,
    summary: oneLine(e.summary),
    image: e.image ?? null,
    absent,
    state: stateLines(e, hereIds),
    voice: voiceNotes(e),
    ...(e.hardRule ? { hardRule: true } : {})
  }
}

/** Everything about a scene's names, as of the end of the scene (its own changes included, as entry pages show it). */
export function sceneNames(db: DB, sceneId: ID): SceneNames {
  const shape = loadShape(db)
  const story = storyOfScene(shape, sceneId)
  if (!story) throw new UserError('That scene no longer exists.')
  const card = sceneCast(db, sceneId)
  const data = loadMemoryData(db)
  const { state, label } = memoryAt(db, { kind: 'scene', storyId: story.id, sceneId }, shape, data)
  const here = new Set(data.changes.filter((c) => c.anchor === 'scene' && c.sceneId === sceneId).map((c) => c.id))
  const entries = [
    ...[...state.entries.values()].map((e) => namedEntry(e, null, here)),
    ...[...state.absent.values()].map((e) => namedEntry(e, ABSENT, here))
  ]
  // The card may still name an entry deleted since; it isn't in the scene any more.
  const live = new Set(entries.map((e) => e.id))
  const povId = card.povId && live.has(card.povId) ? card.povId : null
  return {
    sceneId,
    storyId: story.id,
    label,
    entries,
    cast: {
      povId,
      presentIds: [...new Set(card.presentIds)].filter((id) => live.has(id) && id !== povId),
      locationId: card.locationId && live.has(card.locationId) ? card.locationId : null
    },
    relationships: state.relationships.filter((r) => live.has(r.aId) && live.has(r.bId))
  }
}
