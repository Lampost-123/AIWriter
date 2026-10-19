// Reads the memory model's reply leniently: code fences, words before or after the object,
// comments and trailing commas are all forgiven. Anything still wrong is described in a few
// words, so the model can be told what to fix when it is asked once more. Pure.

export type Parsed = { ok: true; value: unknown } | { ok: false; why: string }

/** Why a reply that ends before its JSON object does can't be read (it may have run into the reply limit). */
export const CUT_OFF = 'it stopped before the JSON object was finished'

/** The balanced {...} or [...] starting at `start` (strings and escapes skipped), or null when the text ends first. */
function balanced(text: string, start: number): string | null {
  const open = text[start]
  const close = open === '[' ? ']' : '}'
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i++) {
    const c = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (c === '\\') escaped = true
      else if (c === '"') inString = false
      continue
    }
    if (c === '"') inString = true
    else if (c === open) depth++
    else if (c === close) {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}

/** The first balanced {...} in the text, or why there isn't one. */
function firstObject(text: string): { ok: true; json: string } | { ok: false; why: string } {
  const start = text.indexOf('{')
  if (start < 0) return { ok: false, why: 'there was no JSON object in it' }
  const json = balanced(text, start)
  return json === null ? { ok: false, why: CUT_OFF } : { ok: true, json }
}

/** JSON text read as it is, else with the usual slips tidied. */
function readJson(json: string): Parsed {
  try {
    return { ok: true, value: JSON.parse(json) }
  } catch {
    /* try again with the usual slips tidied */
  }
  try {
    return { ok: true, value: JSON.parse(tidy(json)) }
  } catch (e) {
    return { ok: false, why: `it wasn't valid JSON (${(e as Error).message.replace(/\s+/g, ' ').slice(0, 120)})` }
  }
}

/**
 * A bare list the reply starts with ([{"from": ...}, ...]: its first bracket comes before any brace), or null for
 * a reply that doesn't. Words in brackets before an object ("[draft] {...}") aren't one, nor is a list cut off
 * before its end: those replies are read for their first object, as before.
 */
function firstList(text: string): Parsed | null {
  const start = text.indexOf('[')
  const brace = text.indexOf('{')
  if (start < 0 || (brace >= 0 && brace < start)) return null
  const json = balanced(text, start)
  if (json === null) return null
  const read = readJson(json)
  if (!read.ok || !Array.isArray(read.value)) return null
  const after = text.slice(start + json.length)
  return read.value.some((v) => v && typeof v === 'object') || !after.includes('{') ? read : null
}

/** Removes // and /* *\/ comments and commas before a closing bracket, outside strings. */
function tidy(json: string): string {
  let out = ''
  let inString = false
  let escaped = false
  for (let i = 0; i < json.length; i++) {
    const c = json[i]
    if (inString) {
      out += c
      if (escaped) escaped = false
      else if (c === '\\') escaped = true
      else if (c === '"') inString = false
      continue
    }
    if (c === '"') {
      inString = true
      out += c
      continue
    }
    if (c === '/' && json[i + 1] === '/') {
      while (i < json.length && json[i] !== '\n') i++
      out += '\n'
      continue
    }
    if (c === '/' && json[i + 1] === '*') {
      const end = json.indexOf('*/', i + 2)
      i = end < 0 ? json.length : end + 1
      continue
    }
    if (c === ',') {
      let j = i + 1
      while (j < json.length && /\s/.test(json[j])) j++
      if (json[j] === '}' || json[j] === ']') continue
    }
    out += c
  }
  return out
}

/**
 * Parses the one JSON object in a model's reply, forgiving the usual slips. A reply that is a bare list (its first
 * bracket before any brace) is read as that list (2026-10-17: a bare list of relationships saved nothing), so a
 * caller wanting an object checks it has one.
 */
export function parseLenient(reply: string): Parsed {
  let text = reply.trim()
  if (!text) return { ok: false, why: 'it was empty' }
  const fence = text.match(/```(?:json|JSON)?\s*([\s\S]*?)```/)
  if (fence && (fence[1].includes('{') || fence[1].trim().startsWith('['))) text = fence[1]
  const list = firstList(text)
  if (list) return list
  const found = firstObject(text)
  if (!found.ok) return found
  return readJson(found.json)
}

/** What a reading reply holds: a verdict for each fact whose words changed, new facts, and clashes with the memory. */
export interface ReadingReply {
  facts: Record<string, unknown>[]
  add: Record<string, unknown>[]
  clashes: Record<string, unknown>[]
  /**
   * A verdict on each pay-off the request asked about (keeper/oneReading.ts payoffAsks): {"id": "E5", "is":
   * "paid|moved|untouched", "note", "quote"}. Only there when the reply gives it.
   */
  payoffs?: Record<string, unknown>[]
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** Checks the shape of a reading reply. Items it can't use are left for the caller to skip one by one. */
export function readingReply(value: unknown): { ok: true; reply: ReadingReply } | { ok: false; why: string } {
  if (!isObj(value)) return { ok: false, why: 'it was not a JSON object' }
  const lists: Record<'facts' | 'add' | 'clashes', string[]> = { facts: ['facts', 'verdicts'], add: ['add', 'new'], clashes: ['clashes', 'clash'] }
  const reply: ReadingReply = { facts: [], add: [], clashes: [] }
  let any = false
  for (const [key, names] of Object.entries(lists) as ['facts' | 'add' | 'clashes', string[]][]) {
    const name = names.find((n) => n in value)
    if (!name) continue
    any = true
    const v = value[name]
    if (v == null) continue
    if (!Array.isArray(v)) return { ok: false, why: `its "${key}" was not a list` }
    reply[key] = v.filter(isObj)
  }
  if (!any) return { ok: false, why: 'it had none of the "facts", "add" and "clashes" lists' }
  // The pay-off verdicts, when given: a list that isn't one is left out, never a reason to ask again.
  const payoffs = value.payoffs ?? value.payoff
  if (Array.isArray(payoffs)) reply.payoffs = payoffs.filter(isObj)
  return { ok: true, reply }
}

/** A string field, trimmed and capped; '' when missing. */
export function str(v: unknown, max = 400): string {
  if (typeof v === 'number') return String(v)
  if (typeof v !== 'string') return ''
  const s = v.replace(/\s+/g, ' ').trim()
  return s.length > max ? s.slice(0, max).trimEnd() : s
}

export function strList(v: unknown, max = 12): string[] {
  if (typeof v === 'string')
    return v
      .split(/[,;]/)
      .map((s) => str(s, 80))
      .filter(Boolean)
      .slice(0, max)
  if (!Array.isArray(v)) return []
  return v
    .map((s) => str(s, 80))
    .filter(Boolean)
    .slice(0, max)
}

export const bool = (v: unknown): boolean => v === true || v === 'true' || v === 'yes'
