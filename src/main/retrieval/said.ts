// What was said (story memory step 5): promises, threats and secrets told are kept by the memory keeper as facts with
// the exact words, who said them and who heard them there (KnowledgePayload.said). This puts together the lines the
// briefing sends word for word, one for each time something was said: those said or heard by someone in the scene,
// then those a search for what the scene is about found. Each line, and the whole list, is kept short. Pure.

import type { FactState, ID, SaidKind } from '@shared/types'
import type { SaidLine } from './types'

/** How many lines the list holds at most. */
export const SAID_MOST = 8
/** A line longer than this many words is cut short (a long speech is the start of it). */
export const SAID_LINE_WORDS = 60
/** The lines together hold at most about this many words. */
export const SAID_LIST_WORDS = 300

/** One time something was said, as the world's changes have it (recall.ts `saidTimes`). */
export interface SaidTime {
  factId: ID
  kind: SaidKind
  by: ID
  /** Who heard it there (not the speaker). */
  heard: ID[]
  /** The line, as its words now read (its source link), else as first read. */
  words: string
  /** Where it was said, in plain words. */
  where: string
  /** Its place on the line before this scene (larger is later). */
  order: number
}

const SAID_KINDS: SaidKind[] = ['promise', 'threat', 'secret']
export const isSaidKind = (v: unknown): v is SaidKind => typeof v === 'string' && (SAID_KINDS as string[]).includes(v)

const WORD = /\S+/g

/** A line cut to at most `n` words, with an ellipsis (keeping its closing quote mark when it opened with one). */
export function shortLine(words: string, n = SAID_LINE_WORDS): string {
  const t = words.trim()
  const ends = [...t.matchAll(WORD)].map((m) => (m.index ?? 0) + m[0].length)
  if (ends.length <= n) return t
  const cut = t.slice(0, ends[n - 1]).replace(/[,;:.!?]+$/, '')
  const close = /^["“]/.test(t) ? '”' : /^['‘]/.test(t) ? '’' : ''
  return `${cut}…${close}`
}

const wordCount = (s: string): number => (s.match(WORD) ?? []).length

/**
 * The lines to send: each time something known here (`facts`, as of this scene) was said, with who said and heard it
 * there. Those whose speaker or a hearer is in the scene come first, newest first; then those found by searching, in
 * the order found. At most `most` lines and about SAID_LIST_WORDS words, each line at most SAID_LINE_WORDS words.
 */
export function saidLines(
  facts: Pick<FactState, 'factId' | 'fact' | 'knownBy'>[],
  times: SaidTime[],
  o: { nameOf: (id: ID) => string | null; inScene: Set<ID>; found?: ID[]; most?: number; words?: number }
): SaidLine[] {
  const known = new Map(facts.map((f) => [f.factId, f]))
  const foundAt = new Map((o.found ?? []).map((id, i) => [id, i]))
  const lines: (SaidLine & { order: number; factId: ID })[] = []
  for (const t of times) {
    const f = known.get(t.factId)
    if (!f || !t.words.trim()) continue
    const here = o.inScene.has(t.by) || t.heard.some((id) => o.inScene.has(id))
    const found = foundAt.has(t.factId)
    if (!here && !found) continue
    const heard = t.heard
      .filter((id) => id !== t.by)
      .map((id) => o.nameOf(id))
      .filter((n): n is string => !!n)
    lines.push({ kind: t.kind, by: o.nameOf(t.by) ?? '', heard, words: shortLine(t.words), fact: f.fact.trim(), where: t.where, here, found, order: t.order, factId: t.factId })
  }
  const near = lines.filter((l) => l.here).sort((a, b) => b.order - a.order)
  const far = lines.filter((l) => !l.here).sort((a, b) => foundAt.get(a.factId)! - foundAt.get(b.factId)! || b.order - a.order)
  const out: SaidLine[] = []
  let total = 0
  for (const { order: _o, factId: _f, ...l } of [...near, ...far]) {
    if (out.length >= (o.most ?? SAID_MOST)) break
    const n = wordCount(l.words) + wordCount(l.fact)
    if (out.length && total + n > (o.words ?? SAID_LIST_WORDS)) break
    out.push(l)
    total += n
  }
  return out
}

const KIND_WORDS: Record<SaidKind, { one: string; whose: (by: string) => string }> = {
  promise: { one: 'A promise', whose: (by) => `${by}’s promise` },
  threat: { one: 'A threat', whose: (by) => `${by}’s threat` },
  secret: { one: 'A secret told', whose: (by) => `A secret ${by} told` }
}

const joinAnd = (items: string[]): string =>
  items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`

/** One line of the briefing: "- Mara’s promise to Tobin (Book 1, Ch 2, Sc 1): “I will come back before the snow.”" */
export function saidText(l: SaidLine): string {
  const k = KIND_WORDS[l.kind]
  const head = l.by ? k.whose(l.by) : k.one
  const to = l.heard.length ? ` to ${joinAnd(l.heard)}` : ''
  const where = l.where ? ` (${l.where})` : ''
  const words = /^["“'‘]/.test(l.words) ? l.words : `“${l.words}”`
  const what = l.fact ? ` That is: ${l.fact.replace(/\.$/, '')}.` : ''
  return `- ${head}${to}${where}: ${words}${what}`
}
