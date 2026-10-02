// What "Add to memory" starts with for the words Adam selected: a change to an entry the words name,
// or a new entry, named after a name in the words when there is one, with the words themselves as
// its description (or the change's note). Pure, so it is unit-tested.
import type { EntryKind, ID } from '@shared/types'
import type { NamedEntry } from '@shared/contracts/manuscript'
import { KIND_LABELS } from '@shared/fields'
import { findNames, type NameIndex } from '../names/nameMatch'

/** The kinds a new entry can be from here (plot threads are made on the scene card). */
export const NEW_KINDS: EntryKind[] = ['character', 'place', 'group', 'item', 'lore', 'event', 'glossary']

export interface AddPrefill {
  mode: 'new' | 'change'
  /** For a new entry. */
  kind: EntryKind
  name: string
  description: string
  /** For a change: the entry it is to (null when the words name none), and its note. */
  entryId: ID | null
  note: string
  /** Entries the words name, in order, offered first for a change. */
  named: ID[]
}

/** The selected words, tidied: no space around them, at most one blank line between paragraphs. */
export const tidySelection = (text: string): string =>
  text
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

/** Capitalised words that start sentences or aren't names. */
const NOT_NAMES = new Set(
  (
    'a an and as at after all also before but by each even every for from had has have he her here hers him his how i if in into ' +
    'is it its just let me my no not now of on once one only or our out she so some still such that the their them then there ' +
    'these they this those though to too until up us was we were what when where which while who why with yes yet you your ' +
    'monday tuesday wednesday thursday friday saturday sunday january february march april may june july august september ' +
    'october november december'
  ).split(' ')
)

/** Small words that may join the words of a name ("Mara of Harrow"), but never start or end one. */
const JOINERS = new Set(['of', 'the', 'de', 'du', 'van', 'von', 'la', 'le'])

const WORD = /\p{L}[\p{L}\p{N}'’-]*/gu
const isCapitalised = (w: string): boolean => /^\p{Lu}/u.test(w)

/** True when the word at `at` starts a sentence: only spaces, opening quotes or brackets since a full stop (or the start). */
function startsSentence(text: string, at: number): boolean {
  for (let i = at - 1; i >= 0; i--) {
    const c = text[i]
    if (/[\s"“‘'(\[—–-]/u.test(c)) continue
    return /[.!?…:;]/u.test(c)
  }
  return true
}

/**
 * The first name in the words that isn't already an entry: a run of capitalised words ("Jory",
 * "Old Tom Farrow", "Mara of Harrow"). A capitalised word that only starts a sentence ("Rain fell")
 * isn't taken for a name. '' when there is none.
 */
export function newName(text: string, index: NameIndex): string {
  const known = findNames(text, index)
  const inKnown = (at: number): boolean => known.some((k) => at >= k.start && at < k.end)
  const words = [...text.matchAll(WORD)].map((m) => {
    const at = m.index ?? 0
    return { w: m[0].replace(/['’]s$/, ''), at, end: at + m[0].length }
  })
  const runs: { words: string[]; sentenceStart: boolean }[] = []
  let run: { words: string[]; sentenceStart: boolean; end: number } | null = null
  const close = (): void => {
    if (!run) return
    while (run.words.length && JOINERS.has(run.words[run.words.length - 1].toLowerCase())) run.words.pop()
    if (run.words.length) runs.push(run)
    run = null
  }
  for (const { w, at, end } of words) {
    const gap = run ? text.slice(run.end, at) : ''
    const joined = run && /^ $/.test(gap)
    if (inKnown(at)) {
      close()
      continue
    }
    if (isCapitalised(w)) {
      if (run && joined) {
        run.words.push(w)
        run.end = end
        continue
      }
      close()
      // A word that isn't a name ("In", "She", "Monday") never starts one; the next capitalised word may.
      if (NOT_NAMES.has(w.toLowerCase()) && !(w === 'The' && /^ \p{Lu}/u.test(text.slice(end, end + 2)))) continue
      run = { words: [w], sentenceStart: startsSentence(text, at), end }
      continue
    }
    if (run && joined && JOINERS.has(w.toLowerCase())) {
      run.words.push(w)
      run.end = end
      continue
    }
    close()
  }
  close()
  // A name mid-sentence is surely one; at a sentence's start only when it is more than one word.
  const pick = runs.find((r) => !r.sentenceStart) ?? runs.find((r) => r.words.length > 1)
  return pick ? pick.words.join(' ') : ''
}

/**
 * Whether a change to an entry can be pinned to the scene: not to a plot thread (those change on the
 * scene card), nor to an entry that isn't in the story yet at this point.
 */
export const canChange = (e: Pick<NamedEntry, 'kind' | 'absent'>): boolean => e.kind !== 'thread' && !e.absent

/** What the form starts with for these words. */
export function prefill(selection: string, index: NameIndex, entries: Map<ID, Pick<NamedEntry, 'kind' | 'absent'>>): AddPrefill {
  const words = tidySelection(selection)
  const named: ID[] = []
  for (const m of findNames(words, index)) {
    const e = entries.get(m.entryId)
    if (e && canChange(e) && !named.includes(m.entryId)) named.push(m.entryId)
  }
  return {
    mode: named.length ? 'change' : 'new',
    kind: 'character',
    name: newName(words, index),
    description: words,
    entryId: named[0] ?? null,
    note: words,
    named
  }
}

/** "Added Jory to your characters." */
export const addedEntryMessage = (name: string, kind: EntryKind): string => `Added ${name} to your ${KIND_LABELS[kind].many.toLowerCase()}.`

/** "Added to memory for Mara: “Lost her left hand in the river.”" */
export function addedChangeMessage(name: string, note: string, max = 60): string {
  const t = note.replace(/\s+/g, ' ').trim()
  return `Added to memory for ${name}: “${t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t}”`
}
