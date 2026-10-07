// Words for searching (story memory step 5, "recall by meaning"): the passages a scene's text is cut into, and the
// words of a text as keyword search counts them. Pure, so every rule is unit-tested.

import { createHash } from 'node:crypto'
import { fold } from '../search/text'
import { textParas } from '../keeper/text'

/** A passage of a scene: a few paragraphs in a row, never across scenes. */
export interface Passage {
  /** Its place in the scene, from 0. */
  n: number
  text: string
  hash: string
}

/** Passages hold at least this many words where the scene allows (short lines of dialogue are joined up). */
export const PASSAGE_MIN_WORDS = 70
/** A passage is closed before it would grow past this many words. */
export const PASSAGE_MAX_WORDS = 220
/** A single paragraph longer than this is cut at sentences. */
export const LONG_PARAGRAPH_WORDS = 320

/** A text's fingerprint: the same words always give the same one (vectors are kept by it). */
export const textHash = (text: string): string => createHash('sha1').update(text.trim()).digest('hex')

const WORD = /[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu
export const countWords = (s: string): number => (s.match(WORD) ?? []).length

/** A long paragraph in pieces of about `max` words, at sentence ends where it can. */
function cutLong(p: string, max: number): string[] {
  const sentences = p.match(/[^.!?…]+(?:[.!?…]+["'”’)\]]*|$)\s*/g) ?? [p]
  const out: string[] = []
  let cur = ''
  for (const s of sentences) {
    if (cur && countWords(cur) + countWords(s) > max) {
      out.push(cur.trim())
      cur = ''
    }
    cur += s
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}

/**
 * A scene's text as passages, in order: paragraphs joined until a passage has PASSAGE_MIN_WORDS, closed before it
 * passes PASSAGE_MAX_WORDS; a paragraph longer than LONG_PARAGRAPH_WORDS is cut at sentences.
 */
export function scenePassages(text: string): Passage[] {
  const paras = textParas(text ?? '').flatMap((p) => (countWords(p.text) > LONG_PARAGRAPH_WORDS ? cutLong(p.text, PASSAGE_MAX_WORDS) : [p.text]))
  const out: string[] = []
  let cur: string[] = []
  let words = 0
  const close = (): void => {
    if (cur.length) out.push(cur.join('\n\n'))
    cur = []
    words = 0
  }
  for (const p of paras) {
    const w = countWords(p)
    if (cur.length && words + w > PASSAGE_MAX_WORDS) close()
    cur.push(p)
    words += w
    if (words >= PASSAGE_MIN_WORDS) close()
  }
  // A short last piece joins the passage before it when that stays within the limit.
  if (cur.length && out.length && words < PASSAGE_MIN_WORDS / 2 && countWords(out[out.length - 1]) + words <= PASSAGE_MAX_WORDS) {
    out[out.length - 1] = `${out[out.length - 1]}\n\n${cur.join('\n\n')}`
    cur = []
  }
  close()
  return out.map((t, n) => ({ n, text: t, hash: textHash(t) }))
}

// ---------- Words as keyword search counts them ----------

/** Words too common to say what a passage is about. */
const STOP = new Set(
  (
    'a about above after again against all almost also am an and any are around as at away back be because been before being below ' +
    'between both but by came can could did do does doing done down during each else even ever every few for from further get gets ' +
    'got had has have having he her here hers herself him himself his how i if in into is it its itself just let like made make many ' +
    'me might more most much must my myself never no nor not now of off on once one only or other our ours ourselves out over own ' +
    'quite rather said same say says see seemed shall she should so some still such than that the their theirs them themselves then ' +
    'there these they thing things this those though through to too toward towards under until up upon us very was way we were what ' +
    'when where whether which while who whom whose why will with within without would yet you your yours yourself yourselves ' +
    "scene scenes story chapter write draft writes written beat beats goal conflict outcome mood tone direction author it's don't " +
    "didn't can't won't i'm he's she's they're we're you're that's there's isn't wasn't aren't weren't"
  ).split(/\s+/)
)

/** A light stem, the same for a text and a search: "promise", "promises", "promised" and "promising" all count as "promis". */
export function stem(w: string): string {
  if (w.length <= 4) return w
  for (const [end, keep] of [
    ['iness', 'y'],
    ['ness', ''],
    ['ings', ''],
    ['ing', ''],
    ['ied', 'y'],
    ['ies', 'y'],
    ['ed', ''],
    ['es', ''],
    ['ly', ''],
    ['s', ''],
    ['e', '']
  ] as const) {
    if (w.endsWith(end) && w.length - end.length >= 3) return w.slice(0, w.length - end.length) + keep
  }
  return w
}

/** The words of a text that say what it is about: folded (case and accents don't count), no common words, stemmed. */
export function terms(text: string): string[] {
  const out: string[] = []
  for (const m of fold(text ?? '').matchAll(/[\p{L}\p{N}]+(?:['’][\p{L}]+)?/gu)) {
    const w = m[0].replace(/’/g, "'")
    if (w.length < 2 || STOP.has(w) || /^\d+$/.test(w)) continue
    out.push(stem(w.replace(/'s$/, '')))
  }
  return out
}

/** The plain words of a text, for SQLite's full-text search (it stems them itself). No common words, each once. */
export function searchWords(text: string): string[] {
  const out = new Set<string>()
  for (const m of fold(text ?? '').matchAll(/[\p{L}\p{N}]+/gu)) {
    const w = m[0]
    if (w.length < 2 || STOP.has(w) || /^\d+$/.test(w)) continue
    out.add(w)
  }
  return [...out]
}
