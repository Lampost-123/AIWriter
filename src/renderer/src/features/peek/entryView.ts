// An entry as the page and the scene panel show it at one scene, in plain words: the hover card, the
// Cast tab and the entry beside the page all read it the same way. Pure, so it is unit-tested.
import type { EntryKind, ID, RelationshipState } from '@shared/types'
import type { NamedEntry, StateLine, VoiceNotes } from '@shared/contracts/manuscript'
import { KIND_LABELS } from '@shared/fields'
import { relationPhrase, upperFirst } from '@/features/world/memoryLogic'

export const displayName = (e: Pick<NamedEntry, 'name'>): string => e.name.trim() || 'Unnamed'

export const kindWord = (kind: EntryKind): string => KIND_LABELS[kind]?.one ?? 'Entry'

/** Where a line of state happened, for after it: "in this scene", or the place in plain words. */
export const whereWords = (line: StateLine): string => (line.here ? 'in this scene' : line.where)

/**
 * The few lines of state a small card has room for: what is true now (the fields changes set) is
 * kept first, and the room left goes to the newest things that happened (in the order they happened).
 */
export function cardLines(state: StateLine[], max = 3): StateLine[] {
  if (state.length <= max) return state
  const happened = state.filter((l) => l.kind === 'happened')
  const fields = state.filter((l) => l.kind === 'field')
  const keepFields = fields.slice(0, Math.max(0, max - Math.min(1, happened.length)))
  const keepHappened = happened.slice(happened.length - (max - keepFields.length))
  return [...keepHappened, ...keepFields]
}

/** What to say when an entry has no state to show yet. */
export function noStateWords(e: Pick<NamedEntry, 'absent' | 'kind'>): string {
  if (e.absent) return e.absent
  return e.kind === 'character' ? 'Nothing has happened to them yet.' : 'Nothing has changed yet.'
}

export interface VoiceRow {
  label: string
  text: string
}

/** A character's voice notes as labelled rows, then up to `samples` sample lines (each a line of its own). */
export function voiceRows(v: VoiceNotes | null, samples = 2): { rows: VoiceRow[]; samples: string[] } {
  if (!v) return { rows: [], samples: [] }
  const rows: VoiceRow[] = []
  if (v.speech) rows.push({ label: 'How they speak', text: v.speech })
  if (v.tics) rows.push({ label: 'Verbal tics', text: v.tics })
  if (v.neverSays) rows.push({ label: 'Never says', text: v.neverSays })
  return { rows, samples: v.sampleLines.slice(0, samples) }
}

export interface RelationRow {
  otherId: ID
  text: string
  /** How each feels, when known: "Mara feels: trusts him · Tobin feels: would die for her". */
  detail: string | null
  /** Where it last changed, in plain words ('' when it has been so from the start). */
  where: string
}

/**
 * An entry's relationships as of a point, read from its side: "Friend of Tobin" when it was written
 * on this entry, "Tobin: enemy of Mara" when written on the other. Relationships with entries that
 * aren't known (deleted) are left out.
 */
export function relationRows(rels: RelationshipState[], self: { id: ID; name: string }, nameOf: (id: ID) => string | null): RelationRow[] {
  const out: RelationRow[] = []
  const selfName = self.name.trim() || 'Unnamed'
  for (const r of rels) {
    const mine = r.aId === self.id
    if (!mine && r.bId !== self.id) continue
    const otherId = mine ? r.bId : r.aId
    const other = nameOf(otherId)
    if (!other) continue
    const type = r.type.trim()
    const text = mine
      ? type
        ? upperFirst(relationPhrase(type, other))
        : `Linked to ${other}`
      : type
        ? `${other}: ${relationPhrase(type, selfName)}`
        : `${other}: linked to ${selfName}`
    const selfFeels = (mine ? r.aFeels : r.bFeels).trim()
    const otherFeels = (mine ? r.bFeels : r.aFeels).trim()
    const parts = [selfFeels && `${selfName} feels: ${selfFeels}`, otherFeels && `${other} feels: ${otherFeels}`].filter(Boolean)
    out.push({ otherId, text, detail: parts.length ? parts.join(' · ') : null, where: r.where })
  }
  return out
}
