// The open scene's words for the editor chat's briefing (the chat overhaul's Phase 3, AIWRITE_EXP_CHAT_SCENE, plan E7).
// An edit almost always read the scene first (read_scene), one more request with the whole briefing again: with its
// words in the briefing, numbered exactly as read_scene numbers them (the same [n] the propose_ tools take, italics as
// *asterisks*, the text as saved, the page's unsaved typing flushed by the window first), the first request can
// propose. A long scene is shown as a window: around the words the question is about (its selection, or the passage it
// quotes), else its last PAGE_WINDOW_WORDS words, with a line saying which paragraphs are left out (read_scene has them).

import type Database from 'better-sqlite3'
import type { ID } from '@shared/types'
import { markedSlice, sceneWords } from './agent'

type DB = Database.Database

/** A scene up to this many words goes in whole (about 3,300 tokens; read_scene itself brings up to 24,000 characters). */
export const PAGE_WHOLE_WORDS = 2500
/** A longer one: this many words around the selection (or at the end). */
export const PAGE_WINDOW_WORDS = 1500
/** The page's smaller form, for a model with little room: this many words around the same place. */
export const PAGE_SMALL_WORDS = 600

export interface PageText {
  /** The block's forms, longest first: the page (whole, or a window), then a smaller window when that is shorter. */
  forms: string[]
  /** Every paragraph is shown (in the first form). */
  whole: boolean
  /** The window is placed around the words the question is about (its selection or its quote), and shows them. */
  anchored: boolean
}

export interface PageInput {
  /** The words selected in the page when the question was asked, with their paragraphs' ids when known. */
  selection?: { text: string; pids?: string[] } | null
  /** The question (an "Ask about this" quote at its top places the window as a selection does). */
  question: string
}

const words = (s: string): number => (s.match(/\S+/g) ?? []).length

/** Text as compared: quotes, dashes and spacing folded, lower case. */
const fold = (s: string): string =>
  s
    .replace(/[‘’`´]/g, "'")
    .replace(/[“”«»„]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/[*_]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase()

/** The passage an "Ask about this" question quotes ("About this passage: “…”"), or ''. */
export function quotedPassage(question: string): string {
  const m = /^About this passage: “([\s\S]*?)”\s*(?:\n|$)/.exec(question.trim())
  return m ? m[1] : ''
}

/** The first and last paragraph (indices into `paras`) the words are in, or null when they can't be found. */
function findPassage(plainParas: string[], text: string): [number, number] | null {
  const t = fold(text).replace(/…$/, '').trim()
  if (t.length < 8) return null
  const folded = plainParas.map(fold)
  const probe = (s: string): number => folded.findIndex((p) => p.includes(s))
  // Its start (a quote may be cut short at its end), then its end; each a few words long, tried shorter if need be.
  const head = [80, 40, 20].map((n) => t.slice(0, n).trim()).filter((x) => x.length >= 8)
  const tail = [80, 40, 20].map((n) => t.slice(-n).trim()).filter((x) => x.length >= 8)
  let a = -1
  for (const h of head) if ((a = probe(h)) >= 0) break
  if (a < 0) return null
  // Its end: in the paragraph as many on as the selection has paragraphs when it is there, else the first after.
  const guess = Math.min(folded.length - 1, a + text.split(/\n\s*\n/).filter((x) => x.trim()).length - 1)
  for (const x of tail) {
    if (folded[guess].includes(x)) return [a, guess]
    const at = folded.findIndex((p, i) => i >= a && p.includes(x))
    if (at >= 0) return [a, at]
  }
  return [a, a]
}

/** Paragraph indices [from, to] holding about `budget` words: around [a, b] (both always in), or at the end. */
function windowOf(counts: number[], budget: number, around: [number, number] | null): [number, number] {
  const n = counts.length
  let [from, to] = around ?? [n - 1, n - 1]
  let total = counts.slice(from, to + 1).reduce((x, y) => x + y, 0)
  // Grow a paragraph at a time, before and after in turn (before first at the end of the scene), while it fits.
  for (let grew = true; grew;) {
    grew = false
    for (const side of around ? ['after', 'before'] : ['before']) {
      if (side === 'before' && from > 0 && total + counts[from - 1] <= budget) {
        total += counts[--from]
        grew = true
      }
      if (side === 'after' && to < n - 1 && total + counts[to + 1] <= budget) {
        total += counts[++to]
        grew = true
      }
    }
  }
  return [from, to]
}

/** The open scene's words as the briefing's page block, or null when the scene is gone or has no words yet. */
export function pageText(db: DB, sceneId: ID, input: PageInput): PageText | null {
  const s = sceneWords(db, sceneId)
  if (!s || !s.marked.trim()) return null
  const paras = s.paras
  const lines = paras.map((p) => `${p.n ? `[${p.n}] ` : ''}${markedSlice(s, p.from, p.to)}`)
  const counts = paras.map((p) => words(s.plain.slice(p.from, p.to)))
  const total = counts.reduce((x, y) => x + y, 0)
  const numberedCount = paras.filter((p) => p.n).length
  const italics = s.marked !== s.plain ? '; *asterisks* mark italics' : ''
  const head = (shown: string): string =>
    `${s.title.trim() ? `“${s.title.trim()}”, ` : ''}${total.toLocaleString('en-GB')} words, ${shown}. [n] numbers each paragraph exactly as read_scene does${italics}: propose from these words and numbers directly; call read_scene only for paragraphs not shown here.`

  // Where the question's words are: the selection's paragraphs by id, else its text, else the passage it quotes.
  const plainParas = paras.map((p) => s.plain.slice(p.from, p.to))
  let around: [number, number] | null = null
  const pids = input.selection?.pids ?? []
  if (pids.length) {
    const at = paras.map((p, i) => (p.pid && pids.includes(p.pid) ? i : -1)).filter((i) => i >= 0)
    if (at.length) around = [Math.min(...at), Math.max(...at)]
  }
  around ??= findPassage(plainParas, input.selection?.text ?? '') ?? findPassage(plainParas, quotedPassage(input.question))

  const form = (budget: number): { text: string; whole: boolean } => {
    if (total <= budget) return { text: `${head(`all ${numberedCount} paragraphs`)}\n\n${lines.join('\n\n')}`, whole: true }
    const [from, to] = windowOf(counts, budget, around)
    const num = (i: number): number =>
      paras
        .slice(0, i + 1)
        .filter((p) => p.n)
        .at(-1)?.n ?? 0
    const first = paras.slice(from, to + 1).find((p) => p.n)?.n ?? num(from)
    const last = num(to)
    const range = (a: number, b: number): string => (a === b ? `paragraph ${a}` : `paragraphs ${a}-${b}`)
    const parts = [head(`${range(first, last)} of ${numberedCount} shown`)]
    if (first > 1) parts.push(`[${range(1, first - 1)} not shown; read_scene for the rest]`)
    parts.push(lines.slice(from, to + 1).join('\n\n'))
    if (last < numberedCount) parts.push(`[${range(last + 1, numberedCount)} not shown; read_scene for the rest]`)
    return { text: parts.join('\n\n'), whole: false }
  }
  const main = form(total <= PAGE_WHOLE_WORDS ? PAGE_WHOLE_WORDS : PAGE_WINDOW_WORDS)
  const small = form(PAGE_SMALL_WORDS)
  const forms = small.text.length < main.text.length ? [main.text, small.text] : [main.text]
  return { forms, whole: main.whole, anchored: !main.whole && !!around }
}
