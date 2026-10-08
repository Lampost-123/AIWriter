// What changed in a scene since its summary was written (World Memory Overhaul A3, 2026-10-08). A scene summary's
// source hash says what it was made from: the scene's words (a hash and a count) and, since this change, each
// paragraph (its id, a hash and a short sketch of its words), so a later read can tell which paragraphs changed and
// about how many words. A summary is due again when about forty words changed, or a changed paragraph names someone or
// something in the memory (newly, or with eight or more of its words changed: never for a typo); a few edited paragraphs can be patched into the old summary instead of summarising the scene
// again. Older hashes (words only) still work: they are compared by the scene's words. Reads only; no Electron imports.

import type Database from 'better-sqlite3'
import type { ID } from '@shared/types'
import { countWords } from '@shared/defaults'
import * as kdb from '../db/keeper'
import * as repo from '../db/repo'
import { hashText, mentionAt, sceneParagraphs, words, type Para } from './text'

type DB = Database.Database

/** Too short to be worth a summary. */
export const MIN_SUMMARY_WORDS = 40
/** About this many words changed makes a summary due again. */
export const DUE_WORDS = 40
/** A changed paragraph that names someone already named in it makes a summary due once this many of its words changed. */
export const NAMED_DUE_WORDS = 8

/** A word's three-character sketch: enough to count words that changed in a paragraph, without keeping its text. */
const sketch = (w: string): string => hashText(w).slice(0, 3)

const cleanId = (id: string): string => id.replace(/[~,|]/g, '')

/** What a scene summary stands for: the scene's words and how many there are, then each paragraph. */
export function sceneSourceHash(text: string, doc: unknown = null): string {
  const paras = sceneParagraphs(doc, text)
  const list = paras.map((p) => `${cleanId(p.id)}~${p.hash.slice(0, 12)}~${words(p.text).map(sketch).join('')}`).join(',')
  return `${hashText(text)}|${countWords(text)}|v2|${list}`
}

/** True when two source hashes stand for the same words (an older hash and a newer one alike). */
export const sameSource = (a: string, b: string): boolean => !!a && a.split('|')[0] === b.split('|')[0]

interface OldPara {
  id: string
  hash: string
  sketches: string[]
}

function oldParas(hash: string): OldPara[] | null {
  const parts = hash.split('|')
  if (parts[2] !== 'v2') return null
  if (!parts[3]) return []
  return parts[3].split(',').map((p) => {
    const [id, h, s] = p.split('~')
    return { id: id ?? '', hash: h ?? '', sketches: (s ?? '').match(/.{3}/g) ?? [] }
  })
}

/** How many words differ between two lists of word sketches (as bags of words). */
function wordsApart(a: string[], b: string[]): number {
  const left = new Map<string, number>()
  for (const x of a) left.set(x, (left.get(x) ?? 0) + 1)
  let common = 0
  for (const x of b) {
    const n = left.get(x) ?? 0
    if (n > 0) {
      common++
      left.set(x, n - 1)
    }
  }
  return Math.max(a.length, b.length) - common
}

export interface SceneChange {
  /** False for an older hash, which says nothing of paragraphs: only `wordsDelta` is known then. */
  known: boolean
  /** Paragraphs new or edited since, as they read now, in scene order. */
  changed: Para[]
  /**
   * Each of `changed` with about how many of its words changed, and the word sketches of the paragraph it was (null for
   * a new paragraph).
   */
  edits: { para: Para; changedWords: number; was: string[] | null }[]
  /** Paragraphs there before that are gone (not just edited). */
  removed: number
  /** About how many words changed (edited, added and deleted). */
  changedWords: number
  /** How many more (or fewer) words the scene has. */
  wordsDelta: number
}

/** What changed in the scene since the summary with this source hash was written. */
export function changeSince(sourceHash: string, text: string, doc: unknown = null): SceneChange {
  const before = Number(sourceHash.split('|')[1]) || 0
  const wordsDelta = countWords(text) - before
  const old = oldParas(sourceHash)
  if (!old) return { known: false, changed: [], edits: [], removed: 0, changedWords: Math.abs(wordsDelta), wordsDelta }
  const now = sceneParagraphs(doc, text)
  const unused = new Map<string, number>()
  for (const p of old) unused.set(p.hash, (unused.get(p.hash) ?? 0) + 1)
  const changed: Para[] = []
  for (const p of now) {
    const h = p.hash.slice(0, 12)
    const n = unused.get(h) ?? 0
    if (n > 0) unused.set(h, n - 1)
    else changed.push(p)
  }
  // Old paragraphs whose words are no longer there: edited (a changed paragraph kept the id) or deleted.
  const leftOver: OldPara[] = []
  for (const p of old) {
    const n = unused.get(p.hash) ?? 0
    if (n > 0) {
      unused.set(p.hash, n - 1)
      leftOver.push(p)
    }
  }
  const byId = new Map(leftOver.map((p) => [p.id, p]))
  let changedWords = 0
  const edits: SceneChange['edits'] = []
  const matched = new Set<string>()
  for (const p of changed) {
    const now = words(p.text).map(sketch)
    let was = byId.get(cleanId(p.id))
    if (was && matched.has(was.id)) was = undefined
    if (!was) {
      // No paragraph with its id (ids differ between the editor and plain text): the most alike one left, if alike enough.
      let best: { p: OldPara; apart: number } | null = null
      for (const o of leftOver) {
        if (matched.has(o.id)) continue
        const apart = wordsApart(o.sketches, now)
        if (!best || apart < best.apart) best = { p: o, apart }
      }
      if (best && best.apart * 2 <= Math.max(best.p.sketches.length, now.length)) was = best.p
    }
    const apart = was ? wordsApart(was.sketches, now) : now.length
    if (was) matched.add(was.id)
    changedWords += apart
    edits.push({ para: p, changedWords: apart, was: was ? was.sketches : null })
  }
  let removed = 0
  for (const p of leftOver) {
    if (matched.has(p.id)) continue
    removed++
    changedWords += p.sketches.length
  }
  return { known: true, changed, edits, removed, changedWords, wordsDelta }
}

/** Names of everyone and everything in the memory, for telling a changed paragraph that names one. */
export function memoryNames(db: DB): string[] {
  return repo
    .listEntries(db)
    .flatMap((e) => [e.name, ...e.aliases])
    .map((n) => n.trim())
    .filter((n) => n.length >= 2)
}

/**
 * True when a scene's summary should be written again (Adam's own never is). `done`: Adam marked the scene done, so any
 * change counts. Otherwise: its words changed since and the summary was marked stale (a fact's words were edited or
 * deleted), or about forty words changed, or a changed paragraph names someone or something in the memory: one it didn't
 * name before, or with eight or more of its words changed (a typo fix or a word or two never counts). Reads only.
 */
export function summaryDue(db: DB, sceneId: ID, done: boolean, names?: string[]): boolean {
  const scene = kdb.keeperScene(db, sceneId)
  if (!scene) return false
  const row = kdb.summaryRow(db, 'scene', sceneId)
  if (row?.origin === 'adam') return false
  if (countWords(scene.text) < MIN_SUMMARY_WORDS) return false
  if (!row) return true
  if (sameSource(row.sourceHash, `${hashText(scene.text)}|`)) return false
  if (done || row.stale) return true
  const c = changeSince(row.sourceHash, scene.text, scene.doc)
  if (c.changedWords >= DUE_WORDS) return true
  if (!c.known) return false
  const all = names ?? memoryNames(db)
  // Whether the paragraph as it was already had all the name's words (by their sketches).
  const namedBefore = (was: string[], n: string): boolean => {
    const left = new Set(was)
    return words(n).every((w) => left.has(sketch(w)))
  }
  return c.edits.some((e) =>
    all.some((n) => mentionAt(e.para.text, n) !== null && (e.changedWords >= NAMED_DUE_WORDS || !e.was || !namedBefore(e.was, n)))
  )
}
