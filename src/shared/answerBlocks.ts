// An editor chat answer read as blocks (the chat overhaul's answer format, AIWRITE_EXP_CHAT_FORMAT, plan "How the model
// marks structure" and A1-A4). The model writes:
//
//   Yes. Mara is 34.                      <- the first line is the lead ("Yes." / "No." / "Not in memory yet." give a verdict)
//   ::facts yes                           <- a fenced block: ::options, ::facts [yes|no|unknown], ::more or ::next,
//   - [[Mara Venn]] is 34 (Ch 2, Sc 1).      closed by a line "::"
//   ::
//   ::options
//   - **The salt lamp**: a tavern sign that fits the harbour.     <- an option: a bold title, then why
//   ::
//
// Anything else is text. Names in [[brackets]] and *italics* are left as they are (the renderer handles them). While an
// answer streams, a block not yet closed is returned as that block with what has arrived (so it never flickers back to
// text), and a marker still being typed ("::opt") is hidden. An answer without markers (an old chat, or a model that
// ignored the format) falls back: its first line (or first sentence, when the line is long) is the lead, and a list of
// 3 or more ideas becomes options. No words are ever dropped, only the marker lines. Pure, shared by the main process
// (history, scoring) and the renderer.

export type Verdict = 'yes' | 'no' | 'unknown'

export type AnswerBlock =
  | { kind: 'lead'; text: string; verdict?: Verdict }
  | { kind: 'options'; items: { title: string; why: string }[] }
  | { kind: 'facts'; verdict?: Verdict; items: string[] }
  | { kind: 'more'; text: string }
  | { kind: 'next'; items: string[] }
  | { kind: 'text'; text: string }

type BlockKind = 'options' | 'facts' | 'more' | 'next'

/** Block names as models write them, and the block each means. */
const KINDS: Record<string, BlockKind> = {
  options: 'options',
  option: 'options',
  ideas: 'options',
  choices: 'options',
  facts: 'facts',
  fact: 'facts',
  sources: 'facts',
  more: 'more',
  why: 'more',
  details: 'more',
  next: 'next',
  followups: 'next',
  'follow-ups': 'next',
  'follow-up': 'next'
}

/** An opening marker: `::options`, `::facts yes`, `::facts: unknown`, `:: Options`. */
const OPEN = /^\s*:{2,3}\s*([a-z][a-z-]*)\s*:?\s*(?:[([]?\s*(yes|no|unknown|unclear|not in memory)\s*[)\]]?\s*)?:?\s*$/i
/** A closing marker: `::` (also `::end`, `::/options`). */
const CLOSE = /^\s*:{2,3}\s*(?:end|\/\s*[a-z-]*)?\s*$/i
/** The last line of a streaming answer that may be a marker still being typed (`:`, `::opt`, `::facts y`). */
const PARTIAL = /^\s*:{1,3}\s*[a-z-]*(?:\s*:?\s*[(]?[a-z ]{0,14})?$/i
/** A list item: `- `, `* `, `• `, `+ `, `1. `, `2) `; group 1 is its indent. */
const ITEM = /^(\s*)(?:[-*•+]|\d{1,2}[.)])\s+/
/** A markdown heading line. */
const HEADING = /^\s*#{1,6}\s/

/** What an opening marker line opens, or null. Unknown names (`::foo`) are not markers. */
function openOf(line: string): { kind: BlockKind; verdict?: Verdict } | null {
  const m = OPEN.exec(line)
  if (!m) return null
  const kind = KINDS[m[1].toLowerCase()]
  if (!kind) return null
  const v = m[2]?.toLowerCase()
  if (kind !== 'facts' || !v) return { kind }
  return { kind, verdict: v === 'yes' ? 'yes' : v === 'no' ? 'no' : 'unknown' }
}

const isClose = (line: string): boolean => CLOSE.test(line)

/** How many words. */
const wordCount = (s: string): number => (s.match(/\S+/g) ?? []).length

/** The verdict a lead opens with. `complete`: the line has ended (a streaming "No" may yet be "No one…"). */
export function verdictOf(lead: string, complete = true): Verdict | undefined {
  const t = lead.trim().replace(/^[*_]{1,2}/, '')
  const end = complete ? '|$' : ''
  if (new RegExp(`^yes[*_]{0,2}(?:[.,!:;]|\\s+[—–-]${end})`, 'i').test(t)) return 'yes'
  if (new RegExp(`^no[*_]{0,2}(?:[.,!:;]|\\s+[—–-]${end})`, 'i').test(t)) return 'no'
  if (/^(?:not in (?:the )?memory|not (?:yet )?established|the memory (?:doesn['’]t|does not) say|unknown)\b/i.test(t)) return 'unknown'
  return undefined
}

/** Abbreviations that end in a full stop without ending the sentence. */
const ABBREV = /\b(?:mr|mrs|ms|dr|st|mt|prof|capt|col|gen|sgt|lt|rev|fr|sr|jr|vs|etc|e\.g|i\.e|no|vol|ch|sc)\.$/i

/** The first sentence of a line (names in [[brackets]] never split), or the whole line. */
export function firstSentence(line: string): string {
  const blotted = line.replace(/\[\[[^[\]\n]*\]\]/g, (m) => '\u0001'.repeat(m.length))
  const re = /[.!?…]+["”’')\]]*(?=\s+\S)/g
  for (let m = re.exec(blotted); m; m = re.exec(blotted)) {
    const end = m.index + m[0].length
    if (ABBREV.test(blotted.slice(0, m.index + 1))) continue
    return line.slice(0, end)
  }
  return line
}

/** The most words a first line may have and still be the lead as a whole (longer, its first sentence is). */
const LEAD_WORDS = 40

/** The lead of some text lines (the first one, not a list item or heading), and the lines after it. */
function takeLead(lines: string[], streaming: boolean): { lead?: { text: string; verdict?: Verdict }; rest: string[] } {
  const i = lines.findIndex((l) => l.trim())
  if (i < 0) return { rest: lines }
  const first = lines[i].trim()
  if (ITEM.test(lines[i]) || HEADING.test(first)) return { rest: lines }
  let text = first
  let after: string[] = lines.slice(i + 1)
  if (wordCount(first) > LEAD_WORDS) {
    const s = firstSentence(first)
    if (s.length < first.length) {
      text = s.trim()
      after = [first.slice(s.length).trim(), ...after]
    }
  }
  const complete = !streaming || i < lines.length - 1 || text !== first
  const verdict = verdictOf(text, complete)
  return { lead: verdict ? { text, verdict } : { text }, rest: after }
}

/** Text lines as text blocks, one per paragraph (blank lines between). */
function paragraphs(lines: string[]): AnswerBlock[] {
  const out: AnswerBlock[] = []
  let buf: string[] = []
  const flush = (): void => {
    const text = buf.join('\n').replace(/^\s*\n|\s+$/g, '').trim()
    if (text) out.push({ kind: 'text', text })
    buf = []
  }
  for (const l of lines) {
    if (l.trim()) buf.push(l.replace(/\s+$/, ''))
    else flush()
  }
  flush()
  return out
}

/**
 * The items of a list: each top-level item, with the lines that carry it on (a line straight after it, or an indented
 * one) joined to it, and nested items joined with "; ". A line on its own with no marker, or one opening in bold, is
 * an item too.
 */
export function listItems(lines: string[]): string[] {
  const items: string[] = []
  let prevBlank = true
  for (const raw of lines) {
    if (!raw.trim()) {
      prevBlank = true
      continue
    }
    const m = ITEM.exec(raw)
    const body = (m ? raw.slice(m[0].length) : raw).trim()
    const indented = (m ? m[1] : /^\s*/.exec(raw)![0]).replace(/\t/g, '  ').length >= 2
    // A line with no marker that opens in bold ("**Four**: …") is a new item too (models drop the dash).
    if ((m || /^(\*\*|__)\S/.test(body)) && !indented) items.push(body)
    else if (items.length && m) items[items.length - 1] = joinTo(items[items.length - 1], body, '; ')
    else if (items.length && (indented || !prevBlank)) items[items.length - 1] = joinTo(items[items.length - 1], body, ' ')
    else items.push(body)
    prevBlank = false
  }
  return items.filter(Boolean)
}

const joinTo = (a: string, b: string, sep: string): string => (!b ? a : !a ? b : `${a}${sep}${b}`)

/** The most words a title before a colon or dash may have. */
const TITLE_WORDS = 8
/** The words a title made from an item with no title of its own keeps. */
const SHORT_TITLE = 5

/** One option from a list item: `**Title**: why`, `Title: why`, `Title — why`, or its first few words. */
export function optionOf(item: string): { title: string; why: string } {
  const t = item.trim()
  const bold = /^(\*\*|__)(.+?)\1(.*)$/s.exec(t)
  if (bold) {
    const title = bold[2].trim().replace(/\s*[:.,;—–-]+$/, '').trim()
    return { title, why: bold[3].replace(/^\s*[:.,;—–-]*\s*/, '').trim() }
  }
  // Bold still arriving: "**The Sal".
  const opening = /^(\*\*|__)([^*_]*)$/.exec(t)
  if (opening) return { title: opening[2].trim(), why: '' }
  const sep = /^(.+?)(?:\s*:(?:\s+|$)|\s+[—–-]\s+|\s*[—–]\s*)(.*)$/s.exec(t)
  if (sep && wordCount(sep[1]) <= TITLE_WORDS && sep[1].length <= 80 && !/\[\[[^\]]*$/.test(sep[1])) return { title: sep[1].trim(), why: sep[2].trim() }
  const words = t.split(/\s+/).filter(Boolean)
  if (words.length <= SHORT_TITLE + 1) return { title: t, why: '' }
  return { title: `${words.slice(0, SHORT_TITLE).join(' ').replace(/[,;:.]+$/, '')}…`, why: t }
}

/** An item, as a list of facts or follow-ups keeps it. */
const plainItem = (s: string): string => s.trim()

/** Words asking for ideas, before a list, that make the list options. */
const IDEAS_WORDS = /\b(ideas?|options?|suggestions?|possibilities|ways|choices|alternatives|names|titles|directions|approaches)\b/i

/** An item that reads as an idea with a title: bold first, or a short title before a colon or dash. */
const titled = (item: string): boolean => /^(\*\*|__).+?\1/.test(item.trim()) || /^[^:—–]{1,60}?(?:\s*:\s+|\s+[—–-]\s+|\s*[—–]\s*)\S/.test(item.trim())

/** Lines split into runs of list (a list item, its continuations, and items after blank lines) and other text. */
function listRuns(lines: string[]): { list: boolean; lines: string[] }[] {
  const out: { list: boolean; lines: string[] }[] = []
  let buf: string[] = []
  let i = 0
  while (i < lines.length) {
    const m = ITEM.exec(lines[i])
    if (!m || m[1].length >= 2) {
      buf.push(lines[i++])
      continue
    }
    if (buf.length) out.push({ list: false, lines: buf })
    buf = []
    let end = i + 1
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j]
      if (!l.trim()) continue
      const prevBlank = !lines[j - 1].trim()
      if (ITEM.test(l) || !prevBlank || /^\s{2,}|^\t/.test(l)) end = j + 1
      else break
    }
    out.push({ list: true, lines: lines.slice(i, end) })
    i = end
  }
  if (buf.length) out.push({ list: false, lines: buf })
  return out
}

/** Text with no markers: paragraphs, with a list of 3 or more ideas made options. */
function fallbackText(lines: string[], before: string, ideas: boolean): AnswerBlock[] {
  const out: AnswerBlock[] = []
  let context = before
  for (const run of listRuns(lines)) {
    if (run.list) {
      const items = listItems(run.lines)
      const ideaList = items.length >= 3 && (ideas || IDEAS_WORDS.test(lastParagraph(context)) || items.filter(titled).length >= items.length - 1)
      if (ideaList) {
        out.push({ kind: 'options', items: items.map(optionOf) })
        context = ''
        continue
      }
    }
    out.push(...paragraphs(run.lines))
    context = run.lines.join('\n')
  }
  return out
}

const lastParagraph = (s: string): string => s.trim().split(/\n\s*\n/).at(-1) ?? ''

/** A block's lines as that block (null for one with nothing in it). */
function blockOf(kind: BlockKind, verdict: Verdict | undefined, lines: string[], keepEmpty: boolean): AnswerBlock | null {
  switch (kind) {
    case 'options': {
      const items = listItems(lines).map(optionOf).filter((o) => o.title || o.why)
      return items.length || keepEmpty ? { kind, items } : null
    }
    case 'facts': {
      const items = listItems(lines).map(plainItem)
      return items.length || keepEmpty ? (verdict ? { kind, verdict, items } : { kind, items }) : null
    }
    case 'next': {
      const items = listItems(lines).map(plainItem)
      return items.length || keepEmpty ? { kind, items } : null
    }
    case 'more': {
      const text = lines.join('\n').replace(/^\s*\n/, '').replace(/\s+$/, '').trim()
      return text || keepEmpty ? { kind, text } : null
    }
  }
}

type Segment = { block: null; lines: string[] } | { block: BlockKind; verdict?: Verdict; lines: string[]; closed: boolean }

/** The answer cut into text and blocks by its marker lines. A stray `::` outside a block is dropped. */
function segments(lines: string[]): Segment[] {
  const out: Segment[] = []
  let cur: Segment | null = null
  for (const line of lines) {
    const open = openOf(line)
    if (open) {
      if (cur?.block) cur.closed = false
      cur = { block: open.kind, ...(open.verdict ? { verdict: open.verdict } : {}), lines: [], closed: false }
      out.push(cur)
      continue
    }
    if (isClose(line)) {
      if (cur?.block) {
        cur.closed = true
        cur = null
      }
      continue
    }
    if (!cur) {
      cur = { block: null, lines: [] }
      out.push(cur)
    }
    cur.lines.push(line)
  }
  return out
}

/** A streaming marker whose block name has arrived but whose verdict is still being typed: `::facts y`. */
const NAMED_PARTIAL = /^\s*:{2,3}\s*([a-z][a-z-]*)\s*:?\s*[([]?\s*[a-z ]*$/i

/**
 * The answer's text, CRLF made LF. At the end of a streaming answer, a marker still being typed is left off, and one
 * whose block name has arrived (`::facts y`) opens that block already, so it doesn't vanish while its verdict arrives.
 */
function answerLines(text: string, streaming: boolean): string[] {
  const lines = (text ?? '').replace(/\r\n?/g, '\n').split('\n')
  const last = lines[lines.length - 1]
  if (!streaming || !last.trim() || openOf(last) || isClose(last)) return lines
  const named = NAMED_PARTIAL.exec(last)
  if (named && KINDS[named[1].toLowerCase()]) lines[lines.length - 1] = `::${named[1]}`
  else if (PARTIAL.test(last)) lines.pop()
  return lines
}

/** Whether an answer uses the block format (has at least one opening marker line). */
export function hasBlockMarkers(text: string): boolean {
  return (text ?? '').replace(/\r\n?/g, '\n').split('\n').some((l) => !!openOf(l))
}

/** The answer's marker lines: blocks opened, how many were closed, stray closes, and whether they all pair up. */
export function answerMarkers(text: string): { opened: number; closed: number; stray: number; balanced: boolean } {
  let opened = 0
  let closed = 0
  let stray = 0
  let open = false
  for (const l of (text ?? '').replace(/\r\n?/g, '\n').split('\n')) {
    if (openOf(l)) {
      opened++
      open = true
    } else if (isClose(l)) {
      if (open) closed++
      else stray++
      open = false
    }
  }
  return { opened, closed, stray, balanced: opened === closed && stray === 0 }
}

/**
 * An answer as blocks. `streaming`: the answer is still arriving (an open block stays that block; a marker being typed
 * is hidden; a verdict waits for its line to end). `ideas`: the question asked for ideas, so an unmarked list of 3 or more
 * items becomes options.
 */
export function parseAnswer(text: string, opts: { streaming?: boolean; ideas?: boolean } = {}): AnswerBlock[] {
  const streaming = !!opts.streaming
  const segs = segments(answerLines(text, streaming))
  const marked = segs.some((s) => s.block)
  const out: AnswerBlock[] = []
  segs.forEach((seg, i) => {
    if (seg.block) {
      const keepEmpty = streaming && i === segs.length - 1 && !seg.closed
      const b = blockOf(seg.block, seg.verdict, seg.lines, keepEmpty)
      if (b) out.push(b)
      return
    }
    let lines = seg.lines
    let before = ''
    if (i === 0) {
      const { lead, rest } = takeLead(lines, streaming && segs.length === 1)
      if (lead) {
        out.push({ kind: 'lead', ...lead })
        before = lead.text
      }
      lines = rest
    }
    out.push(...(marked ? paragraphs(lines) : fallbackText(lines, before, !!opts.ideas)))
  })
  return out
}

/** The words of an answer outside its blocks (the lead and text blocks). */
export function wordsOutsideBlocks(blocks: AnswerBlock[]): number {
  return blocks.reduce((n, b) => n + (b.kind === 'lead' || b.kind === 'text' ? wordCount(b.text) : 0), 0)
}

/** Blocks written back in the format the model writes (for the history the model is shown again). */
export function answerText(blocks: AnswerBlock[]): string {
  const words = (b: AnswerBlock | undefined): boolean => b?.kind === 'lead' || b?.kind === 'text'
  // Paragraphs of text keep a blank line between them (so they read back as separate paragraphs); blocks need none.
  return blocks
    .map((b, i) => (i > 0 && words(b) && words(blocks[i - 1]) ? '\n' : '') + blockText(b))
    .join('\n')
}

/** One block in the format the model writes. */
function blockText(b: AnswerBlock): string {
  switch (b.kind) {
    case 'lead':
    case 'text':
      return b.text
    case 'options':
      return ['::options', ...b.items.map((o) => (o.why ? `- **${o.title}**: ${o.why}` : `- **${o.title}**`)), '::'].join('\n')
    case 'facts':
      return [`::facts${b.verdict ? ` ${b.verdict}` : ''}`, ...b.items.map((x) => `- ${x}`), '::'].join('\n')
    case 'next':
      return ['::next', ...b.items.map((x) => `- ${x}`), '::'].join('\n')
    case 'more':
      return ['::more', b.text, '::'].join('\n')
  }
}
