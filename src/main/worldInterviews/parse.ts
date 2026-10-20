// Reading the replies of the interviews by topic: the next questions (or "done"), the suggested pages and the
// suggested links, as models really send them (fenced JSON, keys in another case, a bare list, plain lines). Then
// telling a repeated question. Pure: what the names stand for in the world is settle.ts's.

import { parseLenient } from '../keeper/json'
import { cleanQuestion } from '../worldBuilder/interview'

const oneLine = (s: unknown): string =>
  String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim()

const str = (v: unknown, max: number): string => (typeof v === 'string' || typeof v === 'number' ? oneLine(v).slice(0, max) : '')

/** An object's keys in lower case, so "Questions" and "questions" read the same. */
function lower(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k.toLowerCase().replace(/[\s_-]/g, ''), x]))
}

function json(reply: string): unknown {
  const p = parseLenient(reply)
  return p.ok ? p.value : null
}

/** The questions in a reply, at most `most`, tidied; `done` when the AI says it has enough. Null when there are none to read. */
export function readQuestions(reply: string, most: number): { questions: string[]; done: boolean } | null {
  const value = json(reply)
  const o = lower(value)
  const list = Array.isArray(value) ? value : o ? (o.questions ?? o.question ?? o.ask ?? o.asks) : undefined
  const done = !!o && (o.done === true || o.enough === true || String(o.done).toLowerCase() === 'true')
  const raw = Array.isArray(list) ? list : typeof list === 'string' ? [list] : []
  const questions = raw
    .map((q) => cleanQuestion(typeof q === 'object' && q ? (lower(q)?.question ?? lower(q)?.text) : q))
    .filter((q) => q && q.length > 3)
    .slice(0, most)
  if (questions.length) return { questions, done: false }
  if (done) return { questions: [], done: true }
  if (value !== null) return null
  // A model that ignored the JSON: its lines that ask something.
  const lines = reply
    .split('\n')
    .map((l) => cleanQuestion(l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '')))
    .filter((l) => l.endsWith('?') && l.length > 3)
    .slice(0, most)
  return lines.length ? { questions: lines, done: false } : null
}

/** Small words that don't tell one question from another. */
const STOP = new Set(
  'a an the and or but of to in on at for with from by is are was were be been do does did what who whom whose which when where why how this that these those it its their they them he she his her you your i me my we our about there here will would could should can any some more most each other else story world'.split(
    ' '
  )
)

function keyWords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/['’]s\b/g, '')
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2 && !STOP.has(w))
      .map((w) => w.replace(/(ies|es|s)$/, ''))
  )
}

/** True when two questions ask mostly the same thing (most of their meaningful words shared). */
export function sameQuestion(a: string, b: string): boolean {
  if (oneLine(a).toLowerCase() === oneLine(b).toLowerCase()) return true
  const x = keyWords(a)
  const y = keyWords(b)
  if (!x.size || !y.size) return false
  const shared = [...x].filter((w) => y.has(w)).length
  return shared >= 2 && shared / Math.min(x.size, y.size) >= 0.7
}

/** The questions that aren't repeats of one asked before, nor of each other. */
export function newQuestions(questions: string[], asked: { question: string }[]): string[] {
  const out: string[] = []
  for (const q of questions) if (!asked.some((a) => sameQuestion(q, a.question)) && !out.some((o) => sameQuestion(q, o))) out.push(q)
  return out
}

/** A suggested page as the reply gives it, before it is matched to the world. */
export interface RawEntry {
  name: string
  aliases: string[]
  summary: string
  fields: Record<string, string>
  in: string
  rule: boolean
}

/** The list a reply holds under one of these keys (or the reply itself, when it is a bare list). */
function listIn(value: unknown, keys: string[]): unknown[] {
  if (Array.isArray(value)) return value
  const o = lower(value)
  if (!o) return []
  for (const k of keys) if (Array.isArray(o[k])) return o[k] as unknown[]
  // One kind's list under any other name ({"characters": [...]}).
  const lists = Object.values(o).filter(Array.isArray) as unknown[][]
  return lists.length === 1 ? lists[0] : []
}

/**
 * The pages in a suggestion reply. A field may come under "fields" or beside the name; only `known` keys count (each
 * value one string, a list joined). Null when the reply holds no list at all.
 */
export function readEntries(reply: string, known: string[]): RawEntry[] | null {
  const value = json(reply)
  if (value === null || typeof value !== 'object') return null
  const items = listIn(value, ['entries', 'pages', 'items'])
  const keys = new Map(known.map((k) => [k.toLowerCase(), k]))
  const out: RawEntry[] = []
  for (const raw of items) {
    const o = lower(raw)
    if (!o) continue
    const name = str(o.name ?? o.title, 120)
    if (!name) continue
    const fields: Record<string, string> = {}
    const take = (k: string, v: unknown): void => {
      const key = keys.get(k.toLowerCase().replace(/[\s_-]/g, ''))
      const text = Array.isArray(v) ? v.map((x) => str(x, 2000)).filter(Boolean).join('\n') : typeof v === 'string' ? v.trim().slice(0, 4000) : ''
      if (key && text && !fields[key]) fields[key] = text
    }
    for (const [k, v] of Object.entries(lower(o.fields) ?? {})) take(k, v)
    for (const [k, v] of Object.entries(o)) take(k, v)
    const aliases = (Array.isArray(o.aliases) ? o.aliases : typeof o.aliases === 'string' ? o.aliases.split(/[,;]/) : [])
      .map((a) => str(a, 80))
      .filter((a) => a && a.toLowerCase() !== name.toLowerCase())
      .slice(0, 6)
    const rule = o.rule === true || String(o.rule).toLowerCase() === 'true'
    out.push({ name, aliases, summary: str(o.summary ?? o.about ?? o.description, 400), fields, in: str(o.in ?? o.inside ?? o.parent, 120), rule })
  }
  return out
}

/** A suggested link as the reply gives it, by names. */
export type RawLink =
  | { link: 'relationship'; from: string; to: string; type: string; feels: string; otherFeels: string; why: string }
  | { link: 'inside'; from: string; to: string; why: string }
  | { link: 'detail'; from: string; field: string; text: string; why: string }

/** The links in a connections reply. Null when the reply holds no list at all. */
export function readLinks(reply: string): RawLink[] | null {
  const value = json(reply)
  if (value === null || typeof value !== 'object') return null
  const out: RawLink[] = []
  for (const raw of listIn(value, ['links', 'connections', 'items'])) {
    const o = lower(raw)
    if (!o) continue
    const why = str(o.why ?? o.because ?? o.reason, 240)
    const inside = str(o.inside ?? o.in ?? o.parent, 120)
    const field = str(o.field ?? o.part, 60)
    const text = typeof o.text === 'string' ? o.text.trim().slice(0, 4000) : typeof o.value === 'string' ? o.value.trim().slice(0, 4000) : ''
    const from = str(o.from ?? o.entry ?? o.page ?? o.name, 120)
    if (!from) continue
    if (inside) out.push({ link: 'inside', from, to: inside, why })
    else if (field && text) out.push({ link: 'detail', from, field, text, why })
    else {
      const to = str(o.to ?? o.other, 120)
      const type = str(o.type ?? o.relationship ?? o.as, 80)
      if (to && type) out.push({ link: 'relationship', from, to, type, feels: str(o.feels, 200), otherFeels: str(o.otherfeels, 200), why })
    }
  }
  return out
}
