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
// Since long story memory fix 12 (2026-10-15), as the writer's briefing reads names (shared/names.ts): a character is
// also found by what this scene's words call them ("the Captain", "her brother": SceneNames.called, read by the
// memory keeper), and "Will" or "May" opening a question ("Will you come?") isn't the name.
//
// The index is built once per change to the list of names; scanning a paragraph is a lookup per
// word, so it stays well within a keystroke even with hundreds of entries. Pure, so it is unit-tested.

import type { EntryKind, ID } from '@shared/types'
import { askingAt } from '@shared/names'
import { isPlaceholderName } from '@/features/world/entryLogic'

export interface NameSource {
  id: ID
  kind: EntryKind
  name: string
  aliases: string[]
  /** What this scene's words call it ("her brother"), when the page is a scene the memory has read (fix 12). */
  called?: string[]
}

export interface NameMatch {
  /** Character range in the text scanned. */
  start: number
  end: number
  entryId: ID
  /** The entry's kind (the desk underlines a name in its kind's ink). */
  kind: EntryKind
  /** Found by what this scene's words call it, not by a name of its own (fix 12). */
  called?: boolean
}

interface Candidate {
  entryId: ID
  kind: EntryKind
  called: boolean
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

/** The names of an entry that are underlined on the page: its own, then what this scene's words call it. */
export function namesToMatch(e: NameSource): string[] {
  return namesOf(e).flat()
}

/** An entry's own names, and what this scene's words call it (as an alias is: never one of its own names again). */
function namesOf(e: NameSource): [string[], string[]] {
  if (e.kind === 'thread') return [[], []]
  const own: string[] = []
  const called: string[] = []
  const add = (raw: string, alias: boolean, to: string[]): void => {
    const n = raw.trim()
    if (n.length < 2 || !FIRST_WORD.test(n) || isPlaceholderName(n)) return
    if (alias && !/^\p{Lu}/u.test(n) && !/\s/.test(n)) return
    if (!own.includes(n) && !called.includes(n)) to.push(n)
  }
  add(e.name, false, own)
  for (const a of e.aliases) add(a, true, own)
  for (const c of e.called ?? []) add(c, true, called)
  return [own, called]
}

/** The key of a list of entries' names: it changes whenever any name, alias, kind or thing a scene calls it does. */
export function nameKey(entries: NameSource[]): string {
  const keys: string[] = []
  for (const e of entries) {
    const [own, called] = namesOf(e)
    if (own.length || called.length) keys.push(`${e.id}\u0001${e.kind}\u0001${own.join('\u0002')}${called.length ? `\u0004${called.join('\u0002')}` : ''}`)
  }
  return keys.sort().join('\u0003')
}

/** Builds the index for a list of entries (once per change to the list, never per keystroke). */
export function buildNameIndex(entries: NameSource[]): NameIndex {
  const byFirst = new Map<string, FirstWord>()
  let size = 0
  for (const e of entries) {
    const [own, called] = namesOf(e)
    for (const n of [...own, ...called]) {
      const [first, second] = WORDS(n)
      const re = new RegExp(`${escapeRe(n).replace(/\s+/g, '\\s+')}(?![\\p{L}\\p{N}])`, ignoresCase(n) ? 'iuy' : 'uy')
      const c = { entryId: e.id, kind: e.kind, called: called.includes(n), re, length: n.length }
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

/** A scene's entries with what its words call each of them (SceneNames.called), as the underlines read names. */
export function withCalled(data: { entries: NameSource[]; called?: { entryId: ID; words: string }[] }): NameSource[] {
  if (!data.called?.length) return data.entries
  const by = new Map<ID, string[]>()
  for (const c of data.called) by.set(c.entryId, [...(by.get(c.entryId) ?? []), c.words])
  return data.entries.map((e) => (by.has(e.id) ? { ...e, called: by.get(e.id) } : e))
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
      // "Will you come?" asks something; it doesn't name Will.
      if (!hit || askingAt(text, at, at + hit[0].length)) continue
      after = at + hit[0].length
      out.push({ start: at, end: after, entryId: c.entryId, kind: c.kind, ...(c.called ? { called: true } : {}) })
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
