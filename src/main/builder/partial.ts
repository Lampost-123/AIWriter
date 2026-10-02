// Reads a JSON object that is still arriving, so the builder can show a profile filling in while
// the model writes it. Only values that have fully arrived are in `value`; the string being written
// when the text ends is reported separately (`open`), with where it goes. Forgiving of the usual
// slips: words or a code fence before the object, comments, missing or extra commas, line breaks
// inside strings. Anything it can't read ends the object there. Pure.

export type Path = (string | number)[]

export interface PartialJson {
  /** The object as far as it has arrived (complete values only); null when no object has started. */
  value: Record<string, unknown> | null
  /** The string being written when the text ends, and where it goes. */
  open: { path: Path; text: string } | null
  /** True once the object has closed. */
  done: boolean
}

/** Thrown when the text ends (or stops making sense) partway through. */
class Stop {}

const ESCAPES: Record<string, string> = { n: '\n', t: '\t', r: '\r', b: '', f: '', '"': '"', '\\': '\\', '/': '/' }
const NUMBER = /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/y

export function parsePartial(text: string): PartialJson {
  const start = text.indexOf('{')
  if (start < 0) return { value: null, open: null, done: false }
  let i = start
  let open: PartialJson['open'] = null

  const space = (): void => {
    for (;;) {
      while (i < text.length && /\s/.test(text[i])) i++
      if (text.startsWith('//', i)) {
        const end = text.indexOf('\n', i)
        i = end < 0 ? text.length : end + 1
      } else if (text.startsWith('/*', i)) {
        const end = text.indexOf('*/', i + 2)
        i = end < 0 ? text.length : end + 2
      } else return
    }
  }

  // A string from the opening quote. With a path, a string cut off by the end of the text is
  // reported as the one being written.
  const string = (path: Path | null): string => {
    i++
    let s = ''
    for (;;) {
      if (i >= text.length) {
        if (path) open = { path, text: s }
        throw new Stop()
      }
      const c = text[i]
      if (c === '"') {
        i++
        return s
      }
      if (c !== '\\') {
        s += c
        i++
        continue
      }
      const e = text[i + 1]
      if (e === undefined) {
        if (path) open = { path, text: s }
        throw new Stop()
      }
      if (e === 'u') {
        const hex = text.slice(i + 2, i + 6)
        if (hex.length < 4) {
          if (path) open = { path, text: s }
          throw new Stop()
        }
        const code = parseInt(hex, 16)
        if (Number.isFinite(code)) s += String.fromCharCode(code)
        i += 6
        continue
      }
      s += ESCAPES[e] ?? e
      i += 2
    }
  }

  const literal = (): unknown => {
    for (const [word, v] of [
      ['true', true],
      ['false', false],
      ['null', null]
    ] as const) {
      if (text.startsWith(word, i)) {
        i += word.length
        return v
      }
      // The word is still arriving.
      if (word.startsWith(text.slice(i))) throw new Stop()
    }
    NUMBER.lastIndex = i
    const m = NUMBER.exec(text)
    // No number here, or one that may not have finished arriving.
    if (!m || i + m[0].length >= text.length) throw new Stop()
    i += m[0].length
    return Number(m[0])
  }

  // Fills `into` as members arrive, so whatever has arrived is in place when the text ends.
  const object = (into: Record<string, unknown>, path: Path): void => {
    i++
    for (;;) {
      space()
      if (i >= text.length) throw new Stop()
      const c = text[i]
      if (c === '}') {
        i++
        return
      }
      if (c === ',') {
        i++
        continue
      }
      if (c !== '"') throw new Stop()
      const key = string(null)
      space()
      if (text[i] !== ':') throw new Stop()
      i++
      space()
      if (i >= text.length) throw new Stop()
      member(key, path, (v) => (into[key] = v))
    }
  }

  const array = (into: unknown[], path: Path): void => {
    i++
    for (;;) {
      space()
      if (i >= text.length) throw new Stop()
      const c = text[i]
      if (c === ']') {
        i++
        return
      }
      if (c === ',') {
        i++
        continue
      }
      member(into.length, path, (v) => into.push(v))
    }
  }

  // One value: objects and lists are put in place before they are read, so their finished members show.
  const member = (key: string | number, path: Path, put: (v: unknown) => void): void => {
    const here = [...path, key]
    const c = text[i]
    if (c === '{') {
      const child: Record<string, unknown> = {}
      put(child)
      object(child, here)
    } else if (c === '[') {
      const child: unknown[] = []
      put(child)
      array(child, here)
    } else if (c === '"') put(string(here))
    else put(literal())
  }

  const root: Record<string, unknown> = {}
  try {
    object(root, [])
    return { value: root, open: null, done: true }
  } catch (e) {
    if (!(e instanceof Stop)) throw e
    return { value: root, open, done: false }
  }
}
