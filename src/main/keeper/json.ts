// Reads the memory model's reply leniently: code fences, words before or after the object,
// comments and trailing commas are all forgiven. Anything still wrong is described in a few
// words, so the model can be told what to fix when it is asked once more. Pure.

export type Parsed = { ok: true; value: unknown } | { ok: false; why: string }

/** The first balanced {...} in the text, or why there isn't one. */
function firstObject(text: string): { ok: true; json: string } | { ok: false; why: string } {
  const start = text.indexOf('{')
  if (start < 0) return { ok: false, why: 'there was no JSON object in it' }
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
    else if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return { ok: true, json: text.slice(start, i + 1) }
    }
  }
  return { ok: false, why: 'it stopped before the JSON object was finished' }
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

/** Parses the one JSON object in a model's reply, forgiving the usual slips. */
export function parseLenient(reply: string): Parsed {
  let text = reply.trim()
  if (!text) return { ok: false, why: 'it was empty' }
  const fence = text.match(/```(?:json|JSON)?\s*([\s\S]*?)```/)
  if (fence && fence[1].includes('{')) text = fence[1]
  const found = firstObject(text)
  if (!found.ok) return found
  try {
    return { ok: true, value: JSON.parse(found.json) }
  } catch {
    /* try again with the usual slips tidied */
  }
  try {
    return { ok: true, value: JSON.parse(tidy(found.json)) }
  } catch (e) {
    return { ok: false, why: `it wasn't valid JSON (${(e as Error).message.replace(/\s+/g, ' ').slice(0, 120)})` }
  }
}

/** What a reading reply holds: a verdict for each fact whose words changed, new facts, and clashes with the memory. */
export interface ReadingReply {
  facts: Record<string, unknown>[]
  add: Record<string, unknown>[]
  clashes: Record<string, unknown>[]
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** Checks the shape of a reading reply. Items it can't use are left for the caller to skip one by one. */
export function readingReply(value: unknown): { ok: true; reply: ReadingReply } | { ok: false; why: string } {
  if (!isObj(value)) return { ok: false, why: 'it was not a JSON object' }
  const lists: Record<keyof ReadingReply, string[]> = { facts: ['facts', 'verdicts'], add: ['add', 'new'], clashes: ['clashes', 'clash'] }
  const reply: ReadingReply = { facts: [], add: [], clashes: [] }
  let any = false
  for (const [key, names] of Object.entries(lists) as [keyof ReadingReply, string[]][]) {
    const name = names.find((n) => n in value)
    if (!name) continue
    any = true
    const v = value[name]
    if (v == null) continue
    if (!Array.isArray(v)) return { ok: false, why: `its "${key}" was not a list` }
    reply[key] = v.filter(isObj)
  }
  if (!any) return { ok: false, why: 'it had none of the "facts", "add" and "clashes" lists' }
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
