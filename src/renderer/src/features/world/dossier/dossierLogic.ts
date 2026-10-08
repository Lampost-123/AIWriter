// An entry's dossier (UI overhaul phase 4, D4.2): what each of its sections shows, worked out without the window. The
// facts along its top (short fields: age, pronouns, a group's kind, when an event happened), the sections under them (the
// kind's field groups, less the facts), how a character speaks with their sample lines as quotes, the line over the name,
// the chapters of the story with the scenes it appears in, and what has happened to it by the scene Adam is in.
// Tested in dossierLogic.test.ts.
import { FIELD_GROUPS, KIND_LABELS, type FieldDef, type FieldGroup } from '@shared/fields'
import type { Appearance } from '@shared/contracts/entryViews'
import type { Entry, EntryKind, ID, Outline } from '@shared/types'
import { relationPhrase, type RelationView } from '../memoryLogic'

/** Shorter words for a fact's label than the form's ("Age or birth date" → "Age"). */
const FACT_LABEL: Record<string, string> = {
  age: 'Age',
  pronouns: 'Pronouns',
  role: 'Role',
  category: 'Kind',
  when: 'When',
  pronunciation: 'Said'
}

export interface Fact {
  key: string
  label: string
  value: string
}

/** The short fields that go along the dossier's top, as the kind's form has them (one-line fields), three at most. */
export function factDefs(kind: EntryKind): FieldDef[] {
  return (FIELD_GROUPS[kind] ?? [])
    .flatMap((g) => g.fields)
    .filter((f) => f.type === 'line' && f.key in FACT_LABEL)
    .slice(0, 3)
}

/** The facts with their values ('' when not filled in: the dossier says "Not set"). A role reads with a capital. */
export function factsOf(e: Pick<Entry, 'kind' | 'fields'>): Fact[] {
  return factDefs(e.kind).map((f) => {
    const raw = (e.fields[f.key] ?? '').trim()
    return {
      key: f.key,
      label: FACT_LABEL[f.key] ?? f.label,
      value: f.key === 'role' && raw ? raw[0].toLocaleUpperCase() + raw.slice(1) : raw
    }
  })
}

export interface DossierGroup {
  group: FieldGroup
  /** Its fields that aren't facts along the top. */
  fields: FieldDef[]
  /** Those filled in, with their words. */
  filled: { def: FieldDef; value: string }[]
}

/**
 * A place's, a group's and an item's one long group of fields, in the parts their builder walks through (its steps), so
 * each is edited on its own and reads under its own heading: by kind, [id, heading, keys]. Display only: the fields are
 * the same ones, saved the same way.
 */
const PARTS: Partial<Record<EntryKind, [string, string, string[]][]>> = {
  place: [
    ['place-look', 'Look and feel', ['atmosphere', 'geography']],
    ['place-senses', 'Sights, sounds and smells', ['senses']],
    ['place-people', 'Who is there', ['people']],
    ['place-history', 'Its history', ['history']]
  ],
  group: [
    ['group-goals', 'Goals and ranks', ['goals', 'ranks']],
    ['group-ways', 'Allies, customs and history', ['rivals', 'customs', 'history']]
  ],
  item: [
    ['item-powers', 'Powers and limits', ['powers', 'limits']],
    ['item-origin', 'Where it came from', ['origin']]
  ]
}

/** The kind's groups of fields as the dossier shows them: its own, or its builder's parts (any field they leave out last). */
function shownGroups(kind: EntryKind): FieldGroup[] {
  const groups = FIELD_GROUPS[kind] ?? []
  const parts = PARTS[kind]
  if (!parts) return groups
  const defs = new Map(groups.flatMap((g) => g.fields.map((f) => [f.key, f] as const)))
  const used = new Set<string>()
  const out: FieldGroup[] = parts.map(([id, label, keys]) => {
    for (const k of keys) used.add(k)
    return { ...groups[0], id, label, fields: keys.map((k) => defs.get(k)).filter((f): f is FieldDef => !!f) }
  })
  const rest = [...defs.values()].filter((f) => !used.has(f.key))
  if (rest.length) out.push({ ...groups[0], fields: rest })
  return out
}

/** The kind's field groups under the facts: each with its fields (less the facts) and the ones filled in. Groups left with no fields are dropped. */
export function dossierGroups(e: Pick<Entry, 'kind' | 'fields'>): DossierGroup[] {
  const facts = new Set(factDefs(e.kind).map((f) => f.key))
  return shownGroups(e.kind)
    .map((group) => {
      const fields = group.fields.filter((f) => !facts.has(f.key))
      const filled = fields.map((def) => ({ def, value: (e.fields[def.key] ?? '').trim() })).filter((x) => x.value)
      return { group, fields, filled }
    })
    .filter((g) => g.fields.length)
}

/** A character's voice as the dossier shows it: how they speak, their sample lines (one a row, quotes taken off) and the rest. */
export function voiceOf(fields: Record<string, string>): { speech: string; lines: string[]; rest: { key: string; value: string }[] } {
  const lines = (fields.sampleLines ?? '')
    .split(/\r?\n/)
    .map((l) =>
      l
        .trim()
        .replace(/^[-•*]\s*/, '')
        .replace(/^["“”']+|["“”']+$/g, '')
        .trim()
    )
    .filter(Boolean)
  const rest = ['tics', 'neverSays'].map((key) => ({ key, value: (fields[key] ?? '').trim() })).filter((x) => x.value)
  return { speech: (fields.speech ?? '').trim(), lines, rest }
}

/** The small capitals over the name: "Character · Protagonist · in 4 scenes", "Lore · Hard rule". */
export function kickerOf(e: Pick<Entry, 'kind' | 'fields' | 'hardRule'>, scenes: number | null): string {
  const parts: string[] = [KIND_LABELS[e.kind].one]
  if (e.kind === 'lore' && e.hardRule) parts.push('Hard rule')
  if (scenes !== null)
    parts.push(scenes ? `in ${scenes.toLocaleString('en-GB')} ${scenes === 1 ? 'scene' : 'scenes'}` : 'not in a scene yet')
  return parts.join(' · ')
}

export interface Band {
  id: ID
  numeral: string
  title: string
  /** Its scenes in order: whether the entry is in each, and whether it is the scene Adam is in. */
  dots: { sceneId: ID; title: string; on: boolean; current: boolean; planned: boolean }[]
}

/** I, II, III … (plain numbers past 39, as the spine does). */
export function numeral(n: number): string {
  if (n < 1 || n > 39) return String(n)
  const tens = ['', 'X', 'XX', 'XXX'][Math.floor(n / 10)]
  const ones = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX'][n % 10]
  return tens + ones
}

/**
 * "Appears in" as bands: each chapter of the story with a dot for each scene, filled where the entry is in it. Chapters
 * it isn't in are left out unless `all` (a short story shows them all, so the gaps read too).
 */
export function appearsBands(
  outline: Pick<Outline, 'chapters' | 'scenes'> | null,
  appears: Pick<Appearance, 'sceneId'>[],
  currentSceneId: ID | null,
  all = false
): Band[] {
  if (!outline) return []
  const inScene = new Set(appears.map((a) => a.sceneId))
  return [...outline.chapters]
    .sort((a, b) => a.position - b.position)
    .map((c, i) => ({
      id: c.id,
      numeral: numeral(i + 1),
      title: c.title.trim() || `Chapter ${i + 1}`,
      dots: outline.scenes
        .filter((s) => s.chapterId === c.id)
        .sort((a, b) => a.position - b.position)
        .map((s) => ({
          sceneId: s.id,
          title: s.title.trim() || 'Untitled scene',
          on: inScene.has(s.id),
          current: s.id === currentSceneId,
          planned: s.status === 'planned'
        }))
    }))
    .filter((b) => b.dots.length && (all || b.dots.some((d) => d.on)))
}

/** Whether an entry has anything written in a group's fields (an empty group's section offers to fill it in). */
export const groupFilled = (g: DossierGroup): boolean => g.filled.length > 0

/**
 * A relationship as one line under the other entry's name, read from this entry's side: "Member of The Harbour Board
 * (harbourmaster) · loyal, uneasily", or when it was written from the other side, "Wren: daughter of Edric".
 */
export function relationLine(
  r: Pick<RelationView, 'fromId' | 'otherId' | 'type' | 'selfFeels'>,
  self: { id: ID; name: string },
  otherName: string
): string {
  const first = (s: string): string => s.trim().split(/\s+/)[0] || s
  const said =
    r.fromId === self.id ? upperFirst(relationPhrase(r.type, otherName)) : `${first(otherName)}: ${relationPhrase(r.type, self.name)}`
  const feels = r.selfFeels.trim()
  return feels ? `${said} · ${feels}` : said
}

const upperFirst = (s: string): string => (s ? s[0].toLocaleUpperCase() + s.slice(1) : s)
