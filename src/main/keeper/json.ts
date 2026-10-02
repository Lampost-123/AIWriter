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

/** What a reading reply holds: a verdict for each fact whose words changed, and new items. */
export interface ReadingReply {
  facts: Record<string, unknown>[]
  new: Record<string, unknown>[]
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** Checks the shape of a reading reply. Items it can't use are left for the caller to skip one by one. */
export function readingReply(value: unknown): { ok: true; reply: ReadingReply } | { ok: false; why: string } {
  if (Array.isArray(value)) return { ok: true, reply: { facts: [], new: value.filter(isObj) } }
  if (!isObj(value)) return { ok: false, why: 'it was not a JSON object' }
  const facts = value.facts ?? value.verdicts ?? []
  const items = value.new ?? value.items ?? []
  if (!Array.isArray(facts)) return { ok: false, why: 'its "facts" was not a list' }
  if (!Array.isArray(items)) return { ok: false, why: 'its "new" was not a list' }
  if (!('facts' in value) && !('new' in value) && !('verdicts' in value) && !('items' in value)) {
    return { ok: false, why: 'it had neither a "facts" nor a "new" list' }
  }
  return { ok: true, reply: { facts: facts.filter(isObj), new: items.filter(isObj) } }
}

/** A string field, trimmed and capped; '' when missing. */
export function str(v: unknown, max = 400): string {
  if (typeof v === 'number') return String(v)
  if (typeof v !== 'string') return ''
  const s = v.replace(/\s+/g, ' ').trim()
  return s.length > max ? s.slice(0, max).trimEnd() : s
}

export function strList(v: unknown, max = 12): string[] {
  if (typeof v === 'string') return v.split(/[,;]/).map((s) => str(s, 80)).filter(Boolean).slice(0, max)
  if (!Array.isArray(v)) return []
  return v.map((s) => str(s, 80)).filter(Boolean).slice(0, max)
}

export const bool = (v: unknown): boolean => v === true || v === 'true' || v === 'yes'
