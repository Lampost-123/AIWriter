// A profile as the builder handles it: which keys a kind has, reading them out of the model's reply
// (whole or still arriving), telling Adam's own words from the AI's, and turning them into an entry
// patch. Pure, so every rule is unit-tested (profile.test.ts).

import { FIELD_GROUPS, type FieldDef } from '@shared/fields'
import type { Entry, EntryInput } from '@shared/types'
import type { BuilderKind, BuilderValues } from '@shared/contracts/builder'
import { plain } from '../keeper/text'
import type { PartialJson } from './partial'

/** The entry's own keys the builder fills, before its kind's fields. */
export const ENTRY_KEYS = ['name', 'aliases', 'summary', 'description'] as const

const ENTRY_DEFS: Record<(typeof ENTRY_KEYS)[number], FieldDef> = {
  name: { key: 'name', label: 'Name', type: 'line' },
  aliases: { key: 'aliases', label: 'Aliases', type: 'line', placeholder: 'other names, titles and nicknames, separated by commas' },
  summary: { key: 'summary', label: 'Short summary', type: 'line', placeholder: 'who or what it is, in one line' },
  description: { key: 'description', label: 'Description', type: 'text', placeholder: 'a short paragraph' }
}

/** Every field a kind's profile has, the entry's own first. */
export function profileFields(kind: BuilderKind): FieldDef[] {
  return [...ENTRY_KEYS.map((k) => ENTRY_DEFS[k]), ...(FIELD_GROUPS[kind] ?? []).flatMap((g) => g.fields)]
}

export const profileKeys = (kind: BuilderKind): string[] => profileFields(kind).map((f) => f.key)

/** The most the AI may put in a field (a long backstory fits; a runaway reply doesn't). Adam's own words aren't cut. */
const MAX_TEXT = 6000
const MAX_LINE = 300

const squash = (s: string): string => s.replace(/\s+/g, ' ').trim()

/**
 * A field's value made tidy: one line for names and short fields, paragraphs kept for long ones.
 * `his`: words copied from Adam's notes, which are never cut short (a runaway reply is, at 300
 * characters for a one-line field and 6000 for a long one).
 */
export function cleanValue(kind: BuilderKind, key: string, raw: string, his = false): string {
  const def = profileFields(kind).find((f) => f.key === key)
  if (key === 'aliases') return listText(raw)
  if (key === 'name') return squash(raw).slice(0, 120).trim()
  if (def?.type === 'line') return his ? squash(raw) : squash(raw).slice(0, MAX_LINE).trim()
  const text = raw
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return his ? text : text.slice(0, MAX_TEXT).trim()
}

/** "Old Brann,  the Ferryman,, Old Brann" -> "Old Brann, the Ferryman". */
export function listText(raw: string): string {
  return splitList(raw).join(', ')
}

export function splitList(raw: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const part of raw.split(/[,;\n]/)) {
    const item = squash(part).replace(/^["“']|["”']$/g, '')
    const key = item.toLocaleLowerCase()
    if (!item || seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  return out
}

/** Aliases as Adam typed them: split at commas only, as the builder's later saves split them, repeats dropped. */
export function splitAliases(raw: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const part of raw.split(',')) {
    const item = part.trim()
    const key = item.toLocaleLowerCase()
    if (!item || seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  return out
}

/** A value from the model's reply as text: lists joined (one per line for sample lines), numbers as written. */
function asText(key: string, v: unknown): string | null {
  if (typeof v === 'string') return v
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  if (Array.isArray(v)) {
    const items = v.filter((x): x is string | number => typeof x === 'string' || typeof x === 'number').map(String)
    return items.length ? items.join(key === 'aliases' ? ', ' : '\n') : null
  }
  return null
}

const looseKey = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '')

/** Finds a key from what the model called it: the key itself, or the field's label ("Core traits"). */
export function keyFinder(kind: BuilderKind): (name: string) => string | null {
  const map = new Map<string, string>()
  for (const f of profileFields(kind)) {
    map.set(looseKey(f.key), f.key)
    map.set(looseKey(f.label), f.key)
  }
  return (name) => map.get(looseKey(name)) ?? null
}

/**
 * Every known field in a reply object, wherever the model put it (some group fields under headings
 * such as "looks"), in the order they come. Values are tidied (`whole`: never cut short, as Adam's
 * own words are kept); empty ones are left out.
 */
export function collectValues(kind: BuilderKind, node: unknown, find = keyFinder(kind), whole = false): BuilderValues {
  const out: BuilderValues = {}
  const walk = (n: unknown, depth: number): void => {
    if (!n || typeof n !== 'object' || Array.isArray(n) || depth > 3) return
    for (const [name, v] of Object.entries(n as Record<string, unknown>)) {
      const key = find(name)
      const text = key ? asText(key, v) : null
      if (key && text != null) {
        const clean = cleanValue(kind, key, text, whole)
        if (clean && !(key in out)) out[key] = clean
      } else if (v && typeof v === 'object' && !Array.isArray(v)) walk(v, depth + 1)
    }
  }
  walk(node, 0)
  return out
}

/** The field being written when the reply ends, if it is one of the profile's (and one of `only`, when given). */
export function writingField(kind: BuilderKind, open: PartialJson['open'], only?: string[]): { key: string; text: string } | null {
  if (!open) return null
  const find = keyFinder(kind)
  const name = [...open.path].reverse().find((p): p is string => typeof p === 'string')
  const key = name ? find(name) : null
  if (!key || (only && !only.includes(key))) return null
  return { key, text: open.text }
}

// ---------- Adam's own words ----------

const WORDISH = /[\p{L}\p{N}]/u

// The notes in plain form, kept for the next look: a reply still arriving is read against them every 40 ms.
let lastNotes: { notes: string; plain: string } | null = null
const plainNotes = (notes: string): string => (lastNotes?.notes === notes ? lastNotes : (lastNotes = { notes, plain: plain(notes) })).plain

/** True when `part` is in `hay` as whole words, not inside longer ones: "Mara" isn't in "Marat", nor "40" in "400". */
function hasWords(hay: string, part: string): boolean {
  const start = WORDISH.test(part.charAt(0))
  const end = WORDISH.test(part.charAt(part.length - 1))
  for (let i = hay.indexOf(part); i >= 0; i = hay.indexOf(part, i + 1)) {
    if ((!start || !WORDISH.test(hay.charAt(i - 1))) && (!end || !WORDISH.test(hay.charAt(i + part.length)))) return true
  }
  return false
}

/**
 * Tells whether a value is copied from Adam's notes: every part of it is in them, as whole words,
 * ignoring capitals, curly quotes and dashes, spacing, and the punctuation around each part. Parts
 * are its sentences, clauses after a semicolon, lines and list items, so a field may gather phrases
 * from different places in the notes. A value longer than the notes themselves (a reply stuck
 * repeating his words) isn't his.
 */
export function hisWordsIn(notes: string): (value: string) => boolean {
  const hay = plainNotes(notes)
  return (value) => {
    if (plain(value).length > hay.length) return false
    const parts = value
      .split(/(?<=[.!?…])\s+|[;\n]|,\s*(?=\S)/)
      .map((p) => plain(p).replace(/^[\s"'(\-–—*•]+|[\s"'),.:;!?…\-–—]+$/g, ''))
      .filter((p) => WORDISH.test(p))
    return parts.length > 0 && parts.every((p) => hasWords(hay, p))
  }
}

export const fromHisWords = (notes: string, value: string): boolean => hisWordsIn(notes)(value)

/** A Quick start profile as far as it has arrived: the fields, which hold Adam's words, and the one being written. */
export interface QuickStartView {
  values: BuilderValues
  fromNotes: string[]
  writing: { key: string; text: string } | null
}

type Part = 'fromNotes' | 'drafted'

/** Which of a Quick start reply's two parts a key names, however the model spelled it ("from_notes"). */
const partOf = (name: string): Part | null =>
  looseKey(name) === 'fromnotes' ? 'fromNotes' : looseKey(name) === 'drafted' ? 'drafted' : null

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/**
 * The object holding a Quick start reply's two parts: the reply itself, or the one object a model
 * wrapped them in ({"character": {"fromNotes": ..., "drafted": ...}}).
 */
export function quickStartRoot(value: Record<string, unknown> | null): Record<string, unknown> {
  const root = value ?? {}
  if (Object.keys(root).some(partOf)) return root
  const inner = Object.values(root)
  return inner.length === 1 && isObject(inner[0]) && Object.keys(inner[0]).some(partOf) ? inner[0] : root
}

/** How many of a Quick start reply's two parts have begun: 0 for a reply without them. */
export function partsBegun(value: Record<string, unknown> | null): number {
  return new Set(Object.keys(quickStartRoot(value)).map(partOf).filter(Boolean)).size
}

/**
 * Reads a Quick start reply ({"fromNotes": {...}, "drafted": {...}}, or the same inside one outer
 * object). Adam's words win: a field whose words really are copied from his notes is his, wherever
 * the model put them (under "fromNotes", under "drafted", or in a reply without the two parts), and
 * they are kept whole. Words the model said were his but aren't count as the AI's, used only where
 * "drafted" has nothing for the field. Fields are in the order they first came in the reply, so a
 * profile shown as it arrives only ever grows at the end.
 */
export function quickStartView(kind: BuilderKind, notes: string, parsed: Pick<PartialJson, 'value' | 'open'>): QuickStartView {
  const root = quickStartRoot(parsed.value)
  const find = keyFinder(kind)
  const names = Object.keys(root)
  const split = names.some(partOf)
  const part = (which: Part): unknown => {
    const name = names.find((n) => partOf(n) === which)
    return name === undefined ? undefined : root[name]
  }
  // Read whole, since his words are never cut short; the AI's are, below.
  const claimed = split ? collectValues(kind, part('fromNotes'), find, true) : {}
  const drafted = collectValues(kind, split ? part('drafted') : root, find, true)
  const isHis = hisWordsIn(notes)
  const his = new Map<string, string>()
  for (const found of [claimed, drafted]) for (const [key, v] of Object.entries(found)) if (!his.has(key) && isHis(v)) his.set(key, v)
  // The reply's parts in the order they arrived (the partial reader fills objects as members come).
  const parts = split ? names.map((n) => (partOf(n) === 'fromNotes' ? claimed : partOf(n) === 'drafted' ? drafted : {})) : [drafted]
  const values: BuilderValues = {}
  for (const p of parts) for (const key of Object.keys(p)) values[key] ??= ''
  for (const key of Object.keys(values)) values[key] = his.get(key) ?? cleanValue(kind, key, drafted[key] ?? claimed[key])
  return { values, fromNotes: Object.keys(values).filter((k) => his.has(k)), writing: writingField(kind, parsed.open) }
}

// ---------- Flesh out and options ----------

/** The step's fields Flesh out may suggest for: the kind's own, and only the empty ones. */
export function fleshOutTargets(kind: BuilderKind, keys: string[], values: BuilderValues): string[] {
  const known = new Set(profileKeys(kind))
  return [...new Set(keys)].filter((k) => known.has(k) && !(values[k] ?? '').trim())
}

/** Suggestions from a Flesh out reply: only for the target fields. */
export function fleshOutValues(kind: BuilderKind, value: unknown, targets: string[]): BuilderValues {
  const all = collectValues(kind, value)
  return Object.fromEntries(Object.entries(all).filter(([k]) => targets.includes(k)))
}

/** The options in a reply as far as it has arrived: {"options": [...]} (or any list of strings in it). */
export function optionsFrom(kind: BuilderKind, key: string, value: unknown): string[] {
  const root = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const list = Array.isArray(root.options) ? root.options : (Object.values(root).find(Array.isArray) ?? [])
  return (list as unknown[]).map((v) => asText(key, v)).filter((v): v is string => v != null).map((v) => cleanValue(kind, key, v))
}

/** Options written as a numbered list rather than JSON ("1. ...", "2. ..."). */
export function optionsFromText(kind: BuilderKind, key: string, text: string): string[] {
  const items: string[][] = []
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*(?:\d+[.)]|[-*•])\s+(.*)$/)
    if (m) items.push([m[1]])
    else if (items.length && line.trim()) items[items.length - 1].push(line.trim())
  }
  return items.map((lines) => cleanValue(kind, key, lines.join('\n').replace(/^["“]|["”]$/g, ''))).filter(Boolean)
}

/** Exactly three different options, or null when the reply doesn't hold three. */
export function pickThree(options: string[]): string[] | null {
  const seen = new Set<string>()
  const out: string[] = []
  for (const o of options) {
    const k = plain(o)
    if (!k || seen.has(k)) continue
    seen.add(k)
    out.push(o)
    if (out.length === 3) return out
  }
  return null
}

// ---------- Interview ----------

/**
 * A character's reply as a line of dialogue: no "Mara:" in front, and no quotation marks around the
 * whole of it. While it is still arriving (`partial`), an opening quotation mark is dropped too.
 */
export function interviewReply(text: string, name: string, partial = false): string {
  let t = text.trim()
  const first = name.trim().split(/\s+/)[0] ?? ''
  for (const n of [...new Set([name.trim(), first])].filter(Boolean)) {
    const escaped = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    t = t.replace(new RegExp(`^(?:\\*\\*)?${escaped}(?:\\*\\*)?\\s*:\\s*`, 'i'), '')
  }
  const pairs: [string, string][] = [
    ['"', '"'],
    ['“', '”']
  ]
  for (const [open, close] of pairs) {
    const inner = t.slice(1, t.endsWith(close) ? -1 : undefined)
    if (t.startsWith(open) && (t.endsWith(close) || partial) && !inner.includes(open) && !inner.includes(close)) {
      t = inner.trim()
      break
    }
  }
  return t
}

// ---------- Entries ----------

/** A field of an entry as the builder shows it. */
export function entryText(e: Pick<Entry, 'name' | 'aliases' | 'summary' | 'description' | 'fields'>, key: string): string {
  if (key === 'name') return e.name
  if (key === 'aliases') return e.aliases.join(', ')
  if (key === 'summary' || key === 'description') return e[key]
  return e.fields[key] ?? ''
}

/** An entry's profile, by key. */
export function valuesOf(kind: BuilderKind, e: Entry): BuilderValues {
  const out: BuilderValues = {}
  for (const key of profileKeys(kind)) {
    const v = entryText(e, key)
    if (v) out[key] = v
  }
  return out
}

/** The fields of an entry's profile that hold Adam's own words. */
export function hisKeys(kind: BuilderKind, e: Entry): string[] {
  return Object.keys(valuesOf(kind, e)).filter((k) => (e.fieldOrigins?.[k] ?? e.origin) === 'adam')
}

/**
 * The entry patch for Adam's own words, saved exactly as he wrote them, as the builder's later saves
 * are: only the name is trimmed, and aliases are split at commas.
 */
export function ownInput(kind: BuilderKind, values: BuilderValues): EntryInput {
  const input: EntryInput = {}
  const fields: Record<string, string> = {}
  const known = new Set(profileKeys(kind))
  for (const [key, v] of Object.entries(values)) {
    if (!known.has(key)) continue
    if (key === 'name') input.name = v.trim()
    else if (key === 'aliases') input.aliases = splitAliases(v)
    else if (key === 'summary') input.summary = v
    else if (key === 'description') input.description = v
    else fields[key] = v
  }
  if (Object.keys(fields).length) input.fields = fields
  return input
}

/** The entry patch that sets these fields (and nothing else), for the AI's words. */
export function toInput(kind: BuilderKind, values: BuilderValues): EntryInput {
  const input: EntryInput = {}
  const fields: Record<string, string> = {}
  const known = new Set(profileKeys(kind))
  for (const [key, v] of Object.entries(values)) {
    if (!known.has(key)) continue
    if (key === 'name') input.name = squash(v)
    else if (key === 'aliases') input.aliases = splitList(v)
    else if (key === 'summary') input.summary = squash(v)
    else if (key === 'description') input.description = v
    else fields[key] = v
  }
  if (Object.keys(fields).length) input.fields = fields
  return input
}
