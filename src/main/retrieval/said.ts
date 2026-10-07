// What was said (story memory step 5): promises, threats and secrets told are kept by the memory keeper as facts with
// the exact words and who heard them (KnowledgePayload.said). This puts together the lines the briefing sends word for
// word: those said or heard by someone in the scene, then those a search for what the scene is about found. Pure.

import type { FactState, ID, SaidKind } from '@shared/types'
import type { SaidLine } from './types'

/** How many lines the briefing's full form holds at most. */
export const SAID_MOST = 8

/** One fact that was said, as the world's changes have it (db/retrieval.ts `saidFacts`). */
export interface SaidFact {
  factId: ID
  kind: SaidKind
  by: ID
  /** The line, as its words now read (its source link), else as first read. */
  words: string
  /** Where it was said, in plain words. */
  where: string
  /** Its place on the line before this scene (larger is later); facts said off the line aren't known here at all. */
  order: number
}

const SAID_KINDS: SaidKind[] = ['promise', 'threat', 'secret']
export const isSaidKind = (v: unknown): v is SaidKind => typeof v === 'string' && (SAID_KINDS as string[]).includes(v)

/**
 * The lines to send: each fact known here (`facts`, as of this scene) that was said, with who said and heard it.
 * Those whose speaker or a hearer is in the scene come first, newest first; then those found by searching, in the
 * order found. At most `most`.
 */
export function saidLines(
  facts: Pick<FactState, 'factId' | 'fact' | 'knownBy'>[],
  said: Map<ID, SaidFact>,
  o: { nameOf: (id: ID) => string | null; inScene: Set<ID>; found?: ID[]; most?: number }
): SaidLine[] {
  const lines: (SaidLine & { order: number; factId: ID })[] = []
  const foundAt = new Map((o.found ?? []).map((id, i) => [id, i]))
  for (const f of facts) {
    const s = said.get(f.factId)
    if (!s || !s.words.trim()) continue
    const by = o.nameOf(s.by) ?? ''
    const heard = f.knownBy.filter((id) => id !== s.by).map((id) => o.nameOf(id)).filter((n): n is string => !!n)
    const here = o.inScene.has(s.by) || f.knownBy.some((id) => o.inScene.has(id))
    const found = foundAt.has(f.factId)
    if (!here && !found) continue
    lines.push({ kind: s.kind, by, heard, words: s.words.trim(), fact: f.fact.trim(), where: s.where, here, found, order: s.order, factId: f.factId })
  }
  const near = lines.filter((l) => l.here).sort((a, b) => b.order - a.order)
  const far = lines.filter((l) => !l.here).sort((a, b) => foundAt.get(a.factId)! - foundAt.get(b.factId)!)
  return [...near, ...far].slice(0, o.most ?? SAID_MOST).map(({ order: _o, factId: _f, ...l }) => l)
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
