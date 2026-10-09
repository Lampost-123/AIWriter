// Origin tags for "What the AI saw" (World Memory Overhaul B6). When the writer's briefing is built, each part records
// what its memory lines rest on: every entry in it (read from the story, or Adam's own), each of the memory's guesses
// and each value sent although its words were edited and not yet confirmed, and each earlier scene's summary that is
// being brought up to date. A tag is kept only when its line went into the form of the part that was sent (a short
// form leaves most details out), found by a few words of it ("probe") that are never stored. A tag holds names and ids
// only, never the line's words, so a record stays small. Pure: no database, no Electron.

import type { EntryState, ID, MemoryTag } from '@shared/types'
import { FIELD_GROUPS } from '@shared/fields'
import type { SceneMemory } from '../memory/types'

/** A tag while the briefing is being fitted: with the words that show its line went into a form. */
export interface DraftTag {
  tag: MemoryTag
  /** Every one of these must be in the form sent (compared without case or spacing). */
  probes: string[]
}

const norm = (s: string): string => s.replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim().toLowerCase()

/** The first few words of a text, as the briefing quotes it. */
const firstFew = (s: string, n = 5): string => (s.match(/\S+/g) ?? []).slice(0, n).join(' ')

/** A field's label in plain words, as the briefing prints it ("Hair", "Distinguishing marks", "Summary"). */
export function tagFieldLabel(kind: EntryState['kind'], field: string): string {
  if (field === 'summary') return 'Summary'
  if (field === 'description') return 'Description'
  for (const g of FIELD_GROUPS[kind] ?? []) for (const f of g.fields) if (f.key === field) return f.label
  return field ? field[0].toUpperCase() + field.slice(1) : field
}

/** How the briefing marks a guess on this field (context.ts formatProfile and fieldSections). */
function guessMarker(field: string, label: string): string {
  if (field === 'summary') return 'In short (guess)'
  if (field === 'description') return 'A guess:'
  return `${label} (guess)`
}

/** An entry's value for a field, as the writer has it. */
function valueOf(e: EntryState, field: string): string {
  if (field === 'summary') return e.summary ?? ''
  if (field === 'description') return e.description ?? ''
  return e.fields?.[field] ?? ''
}

/** The tags of one entry in a part: the entry itself, then its guesses and its unconfirmed values. */
export function entryTags(e: EntryState): DraftTag[] {
  const name = e.name.trim()
  if (!name) return []
  const out: DraftTag[] = [{ tag: { label: name, entryId: e.id, origin: e.origin === 'text' ? 'text' : 'yours', health: 'ok' }, probes: [name] }]
  // A value a later change set (in the story, before this scene) is no guess and no longer the unconfirmed one.
  const later = new Set(e.changed ?? [])
  for (const field of e.guesses ?? []) {
    if (later.has(field) || !valueOf(e, field).trim()) continue
    const fieldLabel = tagFieldLabel(e.kind, field)
    out.push({
      tag: { label: name, entryId: e.id, field, fieldLabel, origin: 'guess', health: 'ok' },
      probes: [name, guessMarker(field, fieldLabel), firstFew(valueOf(e, field))]
    })
  }
  for (const field of e.unsure ?? []) {
    if (later.has(field) || (e.guesses ?? []).includes(field) || !valueOf(e, field).trim()) continue
    const own = field !== 'summary' && (e.fieldOrigins?.[field] ?? e.origin) === 'adam'
    out.push({
      tag: {
        label: name,
        entryId: e.id,
        field,
        fieldLabel: tagFieldLabel(e.kind, field),
        origin: own || e.origin !== 'text' ? 'yours' : 'text',
        health: 'changed'
      },
      probes: [name, firstFew(valueOf(e, field))]
    })
  }
  return out
}

/**
 * The tags of every part, by part id, before the briefing is fitted: entries by the ids each part lists, and the story
 * so far's scene summaries being brought up to date.
 */
export function draftMemoryTags(
  blocks: { id: string; entryIds: ID[] }[],
  memory: Pick<SceneMemory, 'entries' | 'elsewhere' | 'storySoFar'>
): Map<string, DraftTag[]> {
  const byId = new Map<ID, EntryState>([
    ...memory.elsewhere.map((x) => [x.entry.id, x.entry] as const),
    ...memory.entries.map((e) => [e.id, e] as const)
  ])
  const out = new Map<string, DraftTag[]>()
  for (const b of blocks) {
    const tags: DraftTag[] = []
    const seen = new Set<ID>()
    for (const id of b.entryIds) {
      const e = byId.get(id)
      if (!e || seen.has(id)) continue
      seen.add(id)
      tags.push(...entryTags(e))
    }
    if (b.id === 'story-so-far') {
      for (const x of memory.storySoFar?.scenes ?? []) {
        if (!x.updating || !x.text.trim()) continue
        tags.push({ tag: { label: x.label, sceneId: x.sceneId, origin: 'text', health: 'updating' }, probes: [firstFew(x.text)] })
      }
    }
    if (tags.length) out.set(b.id, tags)
  }
  return out
}

/** The tags whose lines went into this form of a part (all their probes are in it), as stored; undefined when none. */
export function sentTags(tags: DraftTag[] | undefined, text: string): MemoryTag[] | undefined {
  if (!tags?.length) return undefined
  const t = norm(text)
  const kept = tags.filter((d) => d.probes.every((p) => !norm(p) || t.includes(norm(p)))).map((d) => d.tag)
  return kept.length ? kept : undefined
}
