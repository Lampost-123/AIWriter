// Pure helpers for the codex (milestone 3): which cards a set of filters keeps, how they sort, how
// they group by kind, and the words on each card. Tested in codexLogic.test.ts.

import { ENTRY_KINDS, KIND_LABELS } from '@shared/fields'
import type { EntryKind, ID } from '@shared/types'
import type { CodexCard } from '@shared/contracts/entryViews'
import { filterEntries, normalizeName } from '@/features/world/entryLogic'

/** Every kind the codex shows, in the binder's order. Plot threads have their own board, so they aren't here. */
export const CODEX_KINDS: EntryKind[] = ENTRY_KINDS.filter((k) => k !== 'thread')

/**
 * The desk's World room shows everything, plot threads too (as index cards, after the rest): the codex's kinds, then
 * threads.
 */
export const GALLERY_KINDS: EntryKind[] = [...CODEX_KINDS, 'thread']

export type CodexSort = 'name' | 'importance' | 'last' | 'first'

export const SORTS: { value: CodexSort; label: string }[] = [
  { value: 'name', label: 'Name' },
  { value: 'importance', label: 'Importance' },
  { value: 'last', label: 'Last appearance' }
]

/** The desk's World room orders by first appearance too (the panels' codex keeps its three). */
export const GALLERY_SORTS: { value: CodexSort; label: string }[] = [{ value: 'first', label: 'First appearance' }, ...SORTS]

export interface CodexFilters {
  /** Words to look for in names, other names and one-liners. */
  query: string
  kind: EntryKind | null
  /** A tag, compared without minding case. */
  tag: string | null
  /** Entries that appear in this story or first exist in it. */
  storyId: ID | null
  /** A character's role, compared without minding case. */
  role: string | null
}

export const NO_FILTERS: CodexFilters = { query: '', kind: null, tag: null, storyId: null, role: null }

/** How many filters are set (the search words count as one). */
export const filtersOn = (f: CodexFilters): number =>
  (f.query.trim() ? 1 : 0) + (f.kind ? 1 : 0) + (f.tag ? 1 : 0) + (f.storyId ? 1 : 0) + (f.role ? 1 : 0)

const fold = (s: string): string => normalizeName(s)

/**
 * The cards the filters keep, in the order given (search matches by name first, as in the entry lists). `kinds`: the
 * kinds shown at all (the codex's by default; the desk's World room adds plot threads).
 */
export function filterCards(cards: CodexCard[], f: CodexFilters, kinds: EntryKind[] = CODEX_KINDS): CodexCard[] {
  const tag = f.tag ? fold(f.tag) : null
  const role = f.role ? fold(f.role) : null
  const kept = cards.filter(
    (c) =>
      kinds.includes(c.kind) &&
      (!f.kind || c.kind === f.kind) &&
      (!tag || c.tags.some((t) => fold(t) === tag)) &&
      (!role || fold(c.role) === role) &&
      (!f.storyId || c.storyIds.includes(f.storyId))
  )
  return f.query.trim() ? filterEntries(kept, f.query) : kept
}

const byName = (a: CodexCard, b: CodexCard): number =>
  displayName(a).localeCompare(displayName(b), undefined, { sensitivity: 'base', numeric: true }) || a.id.localeCompare(b.id)

/**
 * Sorted by name (A to Z), importance (most first), last appearance (latest in the story first,
 * then those that haven't appeared yet) or first appearance (earliest in the story first, then those that haven't
 * appeared yet). Ties go by name, so the order never shuffles.
 */
export function sortCards(cards: CodexCard[], sort: CodexSort): CodexCard[] {
  const list = [...cards]
  if (sort === 'importance') return list.sort((a, b) => b.importance - a.importance || byName(a, b))
  if (sort === 'last') return list.sort((a, b) => (b.last?.order ?? -1) - (a.last?.order ?? -1) || byName(a, b))
  if (sort === 'first') return list.sort((a, b) => (a.first?.order ?? Infinity) - (b.first?.order ?? Infinity) || byName(a, b))
  return list.sort(byName)
}

/**
 * The cards the filters keep, in the chosen order. A search sorted by name puts the names that
 * match first, then other names, then one-liners (A to Z within each), as the entry lists do.
 */
export function shownCards(cards: CodexCard[], f: CodexFilters, sort: CodexSort, kinds: EntryKind[] = CODEX_KINDS): CodexCard[] {
  if (sort === 'name' && f.query.trim()) return filterCards(sortCards(cards, 'name'), f, kinds)
  return sortCards(filterCards(cards, f, kinds), sort)
}

/** What "Nothing matches" says, by what is set: the search words, filters, or both. */
export function nothingMatches(f: CodexFilters): string {
  const filters = filtersOn({ ...f, query: '' })
  if (!f.query.trim()) return `Nothing in the codex matches ${filters > 1 ? 'all of these filters' : 'this filter'}.`
  if (!filters) return 'Nothing in the codex matches your search.'
  return `Nothing in the codex matches your search and ${filters > 1 ? 'these filters' : 'this filter'}.`
}

export interface CodexGroup {
  kind: EntryKind
  /** "Characters", "Glossary". */
  label: string
  cards: CodexCard[]
}

/** The cards grouped by kind, in the codex's order of kinds, keeping their order within each. Kinds with no cards are left out. */
export function groupCards(cards: CodexCard[], kinds: EntryKind[] = CODEX_KINDS): CodexGroup[] {
  const by = new Map<EntryKind, CodexCard[]>()
  for (const c of cards) {
    const list = by.get(c.kind)
    if (list) list.push(c)
    else by.set(c.kind, [c])
  }
  return kinds.filter((k) => by.has(k)).map((kind) => ({ kind, label: KIND_LABELS[kind].many, cards: by.get(kind)! }))
}

/**
 * The desk's World room draws one character larger than the rest, the story's lead: the most important character (point
 * of view counts most, then being in scenes), a protagonist first among equals, then by name. None when there is only
 * one character to show, or when none has been in a scene or been named the protagonist (nobody stands out yet).
 */
export function featuredCard(cards: CodexCard[]): CodexCard['id'] | null {
  const people = cards.filter((c) => c.kind === 'character')
  if (people.length < 2) return null
  const lead = (c: CodexCard): number => (fold(c.role) === 'protagonist' ? 1 : 0)
  const best = [...people].sort((a, b) => b.importance - a.importance || lead(b) - lead(a) || byName(a, b))[0]
  return best.importance > 0 || lead(best) ? best.id : null
}

export interface Choice {
  value: string
  label: string
}

/** Every tag on the cards, once each (as first written), A to Z. */
export function tagChoices(cards: CodexCard[]): Choice[] {
  const seen = new Map<string, string>()
  for (const c of cards) {
    if (!CODEX_KINDS.includes(c.kind)) continue
    for (const t of c.tags) {
      const key = fold(t)
      if (key && !seen.has(key)) seen.set(key, t.trim())
    }
  }
  return [...seen.values()]
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true }))
    .map((t) => ({ value: t, label: t }))
}

const ROLE_ORDER = ['protagonist', 'antagonist', 'supporting', 'minor']

/** Every role given to a character, once each: the usual ones first in story order, then Adam's own words. */
export function roleChoices(cards: CodexCard[]): Choice[] {
  const seen = new Map<string, string>()
  for (const c of cards) {
    const key = fold(c.role)
    if (c.kind === 'character' && key && !seen.has(key)) seen.set(key, c.role.trim())
  }
  const rank = (k: string): number => (ROLE_ORDER.includes(k) ? ROLE_ORDER.indexOf(k) : ROLE_ORDER.length)
  return [...seen.entries()]
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([, role]) => ({ value: role, label: role[0].toLocaleUpperCase() + role.slice(1) }))
}

export const displayName = (c: Pick<CodexCard, 'name'>): string => c.name.trim() || 'Unnamed'

/** The quiet line under a card's one-liner: "In 12 scenes · last in Book 2, Ch 1, Sc 3", or "Not in a scene yet". */
export function appearsLine(c: Pick<CodexCard, 'scenes' | 'last'>): string {
  if (!c.scenes || !c.last) return 'Not in a scene yet'
  return `In ${c.scenes} scene${c.scenes === 1 ? '' : 's'} · last in ${c.last.label}`
}

/** A filter that names something no longer there (a tag removed from every entry, a deleted story) is dropped. */
export function tidyFilters(f: CodexFilters, have: { tags: Choice[]; roles: Choice[]; storyIds: ID[] }): CodexFilters {
  const has = (list: Choice[], v: string | null): boolean => !v || list.some((c) => fold(c.value) === fold(v))
  const next = {
    ...f,
    tag: has(have.tags, f.tag) ? f.tag : null,
    role: has(have.roles, f.role) ? f.role : null,
    storyId: !f.storyId || have.storyIds.includes(f.storyId) ? f.storyId : null
  }
  return next.tag === f.tag && next.role === f.role && next.storyId === f.storyId ? f : next
}
