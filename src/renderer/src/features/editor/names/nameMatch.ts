// Finding the names of known entries in the scene's text, for the faint underlines, the Cast tab's
// "Named in the text" and Add to memory. It follows the memory keeper's rule (mentionAt in
// src/main/keeper/text.ts), so what is underlined is what the memory counts as a mention:
// - a single capitalised word ("Will", "Rose") matches only capitalised; phrases and lower-case
//   names ignore case ("the old woman", "Old Tom");
// - a match is a whole word or phrase: no letter or number just before or after it;
// - names shorter than two characters never match.
// On top of that, for the page: plot threads aren't underlined, nor names the app gives new entries
// before Adam names them, and a lower-case alias only when it has two words or more (so "boss" or
// "smith" never light up across the page). Where names overlap, the longest wins.
//
// The index is built once per change to the list of names; scanning a paragraph is a lookup per
// word, so it stays well within a keystroke even with hundreds of entries. Pure, so it is unit-tested.

import type { EntryKind, ID } from '@shared/types'
import { isPlaceholderName } from '@/features/world/entryLogic'

export interface NameSource {
  id: ID
  kind: EntryKind
  name: string
  aliases: string[]
}

export interface NameMatch {
  /** Character range in the text scanned. */
  start: number
  end: number
  entryId: ID
}

interface Candidate {
  entryId: ID
  /** Sticky: tried at the start of a word. */
  re: RegExp
  length: number
}

interface FirstWord {
  /** Names of one word, longest first. */
  one: Candidate[]
  /** Names of two words or more by their second word in lower case, longest first. */
  bySecond: Map<string, Candidate[]>
}

export interface NameIndex {
  /** Names by their first word in lower case (so a common first word like "the" costs one lookup, not one try per name). */
  byFirst: Map<string, FirstWord>
  /** How many names are indexed. */
  size: number
  /** Changes whenever any name, alias or kind does, so the page underlines again only then. */
  key: string
}

export const EMPTY_INDEX: NameIndex = { byFirst: new Map(), size: 0, key: '' }

const WORD = /[\p{L}\p{N}]+/gu
const FIRST_WORD = /^[\p{L}\p{N}]+/u
const WORDS = (s: string): string[] => (s.match(WORD) ?? []).map((w) => w.toLowerCase())
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** True when a name is matched whatever its case (mentionAt: a phrase, or not capitalised). */
export const ignoresCase = (name: string): boolean => /\s/.test(name) || !/^\p{Lu}/u.test(name)

/** The names of an entry that are underlined on the page. */
export function namesToMatch(e: NameSource): string[] {
  if (e.kind === 'thread') return []
  const out: string[] = []
  const add = (raw: string, alias: boolean): void => {
    const n = raw.trim()
    if (n.length < 2 || !FIRST_WORD.test(n) || isPlaceholderName(n)) return
    if (alias && !/^\p{Lu}/u.test(n) && !/\s/.test(n)) return
    if (!out.includes(n)) out.push(n)
  }
  add(e.name, false)
  for (const a of e.aliases) add(a, true)
  return out
}

/** The key of a list of entries' names: it changes whenever any name, alias or kind does. */
export function nameKey(entries: NameSource[]): string {
  const keys: string[] = []
  for (const e of entries) {
    const names = namesToMatch(e)
    if (names.length) keys.push(`${e.id}\u0001${e.kind}\u0001${names.join('\u0002')}`)
  }
  return keys.sort().join('\u0003')
}

/** Builds the index for a list of entries (once per change to the list, never per keystroke). */
export function buildNameIndex(entries: NameSource[]): NameIndex {
  const byFirst = new Map<string, FirstWord>()
  let size = 0
  for (const e of entries) {
    for (const n of namesToMatch(e)) {
      const [first, second] = WORDS(n)
      const re = new RegExp(`${escapeRe(n).replace(/\s+/g, '\\s+')}(?![\\p{L}\\p{N}])`, ignoresCase(n) ? 'iuy' : 'uy')
      const c = { entryId: e.id, re, length: n.length }
      let slot = byFirst.get(first)
      if (!slot) byFirst.set(first, (slot = { one: [], bySecond: new Map() }))
      if (second === undefined) slot.one.push(c)
      else {
        const list = slot.bySecond.get(second)
        if (list) list.push(c)
        else slot.bySecond.set(second, [c])
      }
      size++
    }
  }
  const longestFirst = (a: Candidate, b: Candidate): number => b.length - a.length
  for (const slot of byFirst.values()) {
    slot.one.sort(longestFirst)
    for (const list of slot.bySecond.values()) list.sort(longestFirst)
  }
  return { byFirst, size, key: nameKey(entries) }
}

/** The index for a list of entries: `prev` itself when no name changed (entries change far more often than names). */
export function updateNameIndex(prev: NameIndex, entries: NameSource[]): NameIndex {
  return nameKey(entries) === prev.key ? prev : buildNameIndex(entries)
}

/** Every name in the text, in order, none overlapping (the longest wins where two start together). */
export function findNames(text: string, index: NameIndex): NameMatch[] {
  const out: NameMatch[] = []
  if (!index.size || !text) return out
  const starts: number[] = []
  const lower: string[] = []
  for (const m of text.matchAll(WORD)) {
    starts.push(m.index ?? 0)
    lower.push(m[0].toLowerCase())
  }
  let after = 0
  const tryAt = (list: Candidate[] | undefined, at: number): boolean => {
    if (!list) return false
    for (const c of list) {
      c.re.lastIndex = at
      const hit = c.re.exec(text)
      if (!hit) continue
      after = at + hit[0].length
      out.push({ start: at, end: after, entryId: c.entryId })
      return true
    }
    return false
  }
  for (let i = 0; i < starts.length; i++) {
    const at = starts[i]
    if (at < after) continue
    const slot = index.byFirst.get(lower[i])
    if (!slot) continue
    // A name of two words or more is longer than any one-word name starting the same way, so it goes first.
    if (i + 1 < lower.length && tryAt(slot.bySecond.get(lower[i + 1]), at)) continue
    tryAt(slot.one, at)
  }
  return out
}

/** The entries named in the text, in the order they are first named. */
export function entriesNamedIn(text: string, index: NameIndex): ID[] {
  const seen = new Set<ID>()
  for (const m of findNames(text, index)) seen.add(m.entryId)
  return [...seen]
}
