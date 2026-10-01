// Pure helpers for the world bible screens. No React and no API calls here,
// so they're easy to test (see entryLogic.test.ts).

import type { Entry, EntryKind, ID } from '@shared/types'

type Named = Pick<Entry, 'id' | 'kind' | 'name' | 'aliases'>

/** Lower case, accents removed, spaces tidied: "  Márra " -> "marra". */
export function normalizeName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLocaleLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/** True when a and b differ by at most one inserted, removed or changed letter. */
export function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true
  const la = a.length
  const lb = b.length
  if (Math.abs(la - lb) > 1) return false
  let i = 0
  while (i < la && i < lb && a[i] === b[i]) i++
  if (la === lb) return a.slice(i + 1) === b.slice(i + 1)
  return la > lb ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1)
}

/** True when the one letter that differs between two near-identical names is a digit ("Guard 1" and "Guard 2"). */
export function differsByDigit(a: string, b: string): boolean {
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  return /\d/.test(a[i] ?? '') || /\d/.test(b[i] ?? '')
}

/** Names the app gives new entries before Adam names them. They never count as duplicates. */
export const isPlaceholderName = (name: string): boolean => /^(unnamed|new (character|place|lore))$/.test(normalizeName(name))

export interface NearDuplicate {
  entry: Named
  /** 'same' = identical name, 'similar' = one letter apart, 'alias' = a name or alias is shared. */
  reason: 'same' | 'similar' | 'alias'
}

/**
 * Other entries in the world whose name is the same or one letter away from this
 * one ("Marra" vs "Mara"), or that share a name or alias with it. Used for a soft
 * warning, never to block. Names shorter than three letters only match exactly,
 * and names that differ only by a number ("Guard 1", "Guard 2") don't count.
 */
// Normalised names per entry object, so the check stays quick in a big world while a name is typed.
const namesCache = new WeakMap<object, { name: string; all: string[]; placeholder: boolean }>()
function namesOf(e: Named): { name: string; all: string[]; placeholder: boolean } {
  let n = namesCache.get(e)
  if (!n) {
    const name = normalizeName(e.name)
    n = { name, all: [name, ...e.aliases.map(normalizeName)].filter(Boolean), placeholder: isPlaceholderName(name) }
    namesCache.set(e, n)
  }
  return n
}

export function findNearDuplicates(self: Named, others: Named[], limit = 3): NearDuplicate[] {
  const name = normalizeName(self.name)
  if (!name || isPlaceholderName(name)) return []
  const mine = new Set([name, ...self.aliases.map(normalizeName)].filter(Boolean))
  const out: NearDuplicate[] = []
  for (const o of others) {
    if (o.id === self.id) continue
    const { name: other, all, placeholder } = namesOf(o)
    if (!other || placeholder) continue
    let reason: NearDuplicate['reason'] | null = null
    if (other === name) reason = 'same'
    else if (Math.min(name.length, other.length) >= 3 && withinOneEdit(name, other) && !differsByDigit(name, other)) reason = 'similar'
    else if (all.some((n) => mine.has(n))) reason = 'alias'
    if (reason) {
      out.push({ entry: o, reason })
      if (out.length >= limit) break
    }
  }
  return out
}

type Place = Pick<Entry, 'id' | 'name' | 'parentId'>

/** The place and everything inside it (rooms inside the castle inside the city). Safe against loops. */
export function placeAndDescendants(places: Place[], rootId: ID): Set<ID> {
  const children = new Map<ID, ID[]>()
  for (const p of places) {
    if (!p.parentId) continue
    const list = children.get(p.parentId) ?? []
    list.push(p.id)
    children.set(p.parentId, list)
  }
  const out = new Set<ID>([rootId])
  const stack = [rootId]
  while (stack.length) {
    for (const c of children.get(stack.pop()!) ?? []) {
      if (!out.has(c)) {
        out.add(c)
        stack.push(c)
      }
    }
  }
  return out
}

/** Names from the outermost place down to this one: ["Varn", "Castle Varn", "Great Hall"]. Safe against loops. */
export function placePath(places: Place[], id: ID): string[] {
  const byId = new Map(places.map((p) => [p.id, p]))
  const names: string[] = []
  const seen = new Set<ID>()
  let cur = byId.get(id)
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id)
    names.unshift(cur.name || 'Unnamed')
    cur = cur.parentId ? byId.get(cur.parentId) : undefined
  }
  return names
}

export interface PlaceOption {
  value: ID
  label: string
}

/** Places that can hold `selfId`: every place except itself and the places inside it. Labelled by path. */
export function parentPlaceOptions(places: Place[], selfId: ID | null): PlaceOption[] {
  const blocked = selfId ? placeAndDescendants(places, selfId) : new Set<ID>()
  return placeOptions(places.filter((p) => !blocked.has(p.id)), places)
}

/** All places as select options labelled by path ("Varn › Castle Varn"), sorted by that path. */
export function placeOptions(choices: Place[], all: Place[] = choices): PlaceOption[] {
  return choices
    .map((p) => ({ value: p.id, label: placePath(all, p.id).join(' › ') }))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }))
}

/** Splits "Mara, the old woman ,, Captain" into ["Mara", "the old woman", "Captain"], dropping repeats. */
export function parseList(text: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of text.split(',')) {
    const item = raw.trim()
    const key = item.toLocaleLowerCase()
    if (!item || seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  return out
}

type Searchable = Pick<Entry, 'name' | 'aliases' | 'summary'>

// Normalised text per entry object, so searching a long list doesn't redo it on every keystroke.
const searchText = new WeakMap<object, { name: string; aliases: string; all: string }>()
function textOf(e: Searchable): { name: string; aliases: string; all: string } {
  let t = searchText.get(e)
  if (!t) {
    const name = normalizeName(e.name)
    const aliases = e.aliases.map(normalizeName).join(' | ')
    t = { name, aliases, all: `${name} | ${aliases} | ${normalizeName(e.summary)}` }
    searchText.set(e, t)
  }
  return t
}

/**
 * Instant search over name, aliases and one-line summary. Every word typed must
 * match somewhere. Name matches come first, then aliases, then summaries; the
 * original order is kept within each.
 */
export function filterEntries<T extends Searchable>(entries: T[], query: string): T[] {
  const words = normalizeName(query).split(' ').filter(Boolean)
  if (!words.length) return entries
  const ranked: { e: T; rank: number; i: number }[] = []
  entries.forEach((e, i) => {
    const { name, aliases, all } = textOf(e)
    if (!words.every((w) => all.includes(w))) return
    const first = words[0]
    const rank = name.startsWith(first) ? 0 : name.includes(first) ? 1 : aliases.includes(first) ? 2 : 3
    ranked.push({ e, rank, i })
  })
  return ranked.sort((a, b) => a.rank - b.rank || a.i - b.i).map((r) => r.e)
}

/** How many of the given field keys have something in them. */
export function filledCount(fields: Record<string, string>, keys: string[]): number {
  return keys.filter((k) => (fields[k] ?? '').trim()).length
}

/** "a character", "a place", "lore": for sentences. */
export function kindNoun(kind: EntryKind): string {
  if (kind === 'lore') return 'lore entry'
  if (kind === 'thread') return 'plot thread'
  if (kind === 'glossary') return 'term'
  return kind
}
