// Just enough XML for reading a Word file: walks the tags and text of one part (word/document.xml,
// word/styles.xml) in order, without building a tree, so a 150,000-word book is read in one quick pass.
// Comments, processing instructions and CDATA are passed over; entities are decoded. Pure.

export interface XmlTag {
  type: 'open' | 'close' | 'empty'
  /** With its prefix: 'w:p', 'w:t'. */
  name: string
  /** The attributes as written, read with `attr`. */
  attrs: string
}

export interface XmlText {
  type: 'text'
  text: string
}

export type XmlToken = XmlTag | XmlText

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

/** Decodes &amp;, &lt;, &#8217;, &#x2019; and the like. */
export function decodeEntities(s: string): string {
  if (!s.includes('&')) return s
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ''
    }
    return ENTITIES[e.toLowerCase()] ?? whole
  })
}

const ATTR_RES = new Map<string, RegExp>()

/** One attribute's value ('w:val'), decoded; null when the tag doesn't have it. */
export function attr(attrs: string, name: string): string | null {
  if (!attrs) return null
  let re = ATTR_RES.get(name)
  if (!re) {
    re = new RegExp(`(?:^|\\s)${name.replace(/[.:]/g, (c) => `\\${c}`)}\\s*=\\s*("([^"]*)"|'([^']*)')`)
    ATTR_RES.set(name, re)
  }
  const m = re.exec(attrs)
  return m ? decodeEntities(m[2] ?? m[3] ?? '') : null
}

/** The tags and text of an XML document, in order. */
export function* xmlTokens(xml: string): Generator<XmlToken> {
  let i = 0
  const n = xml.length
  while (i < n) {
    const lt = xml.indexOf('<', i)
    if (lt < 0) {
      yield { type: 'text', text: decodeEntities(xml.slice(i)) }
      return
    }
    if (lt > i) yield { type: 'text', text: decodeEntities(xml.slice(i, lt)) }
    if (xml.startsWith('<!--', lt)) {
      const end = xml.indexOf('-->', lt + 4)
      i = end < 0 ? n : end + 3
      continue
    }
    if (xml.startsWith('<![CDATA[', lt)) {
      const end = xml.indexOf(']]>', lt + 9)
      yield { type: 'text', text: xml.slice(lt + 9, end < 0 ? n : end) }
      i = end < 0 ? n : end + 3
      continue
    }
    if (xml[lt + 1] === '?' || xml[lt + 1] === '!') {
      const end = xml.indexOf('>', lt + 1)
      i = end < 0 ? n : end + 1
      continue
    }
    // A '>' inside a quoted attribute value is allowed in XML, so the tag ends at the first '>' outside quotes.
    let j = lt + 1
    let quote = ''
    for (; j < n; j++) {
      const c = xml[j]
      if (quote) {
        if (c === quote) quote = ''
      } else if (c === '"' || c === "'") quote = c
      else if (c === '>') break
    }
    const inner = xml.slice(lt + 1, j)
    i = j + 1
    if (inner[0] === '/') {
      yield { type: 'close', name: inner.slice(1).trim(), attrs: '' }
      continue
    }
    const empty = inner.endsWith('/')
    const body = empty ? inner.slice(0, -1) : inner
    const space = body.search(/\s/)
    const name = space < 0 ? body : body.slice(0, space)
    yield { type: empty ? 'empty' : 'open', name, attrs: space < 0 ? '' : body.slice(space) }
  }
}
