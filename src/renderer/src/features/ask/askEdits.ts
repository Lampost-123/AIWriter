// The editor chat's changes to a scene's words, worked out on documents alone (no editor, no window), so they are
// unit-tested. applyProposal.ts makes them in the page; Undo puts back exactly what one changed:
//  - Applying records the scene's paragraphs it touched, as they were and as they became.
//  - Undo finds those paragraphs as they became (by the first one's paragraph id) and puts the old ones back, in the
//    page when the scene is open, else in the saved scene. When Adam has changed them since, nothing is touched.
//  - The chat reads italics as *…* (and bold as **…**): quoted words are found with or without the markers, and new
//    words with them get italics (or bold) as a streamed draft's do (streamText.parseEmphasis).
import { Fragment, Slice, type Node as PMNode, type Schema } from '@tiptap/pm/model'
import type { ParaAnchor } from '@shared/contracts/ask'
import { findTextRange, findTextRangeAfter } from '@/features/editor/findText'
import { hasEmphasis, parseEmphasis } from '@/features/editor/streamText'

export const NOT_FOUND =
  'The words this change looks for aren’t in the scene any more: another change or your own editing changed them. Ask again for a fresh one.'
export const NOT_PLAIN =
  'This rewrite runs across a scene break (or something that isn’t a paragraph), so it wasn’t applied. Ask for one that stays between the breaks.'

/** Quoted words as the page has them: Markdown emphasis markers taken out ("*very* dark" → "very dark"). */
export const plainOf = (quote: string): string => (hasEmphasis(quote) ? parseEmphasis(quote).map((p) => p.text).join('') : quote)

/** Where quoted words are in the scene (with or without their *…* markers), or null. */
export function findQuote(doc: PMNode, quote: string): { from: number; to: number } | null {
  return findTextRange(doc, quote) ?? (hasEmphasis(quote) ? findTextRange(doc, plainOf(quote)) : null)
}

/** Where quoted words are at or after `after` (with or without their *…* markers), or null. */
export function findQuoteAfter(doc: PMNode, quote: string, after: number): { from: number; to: number } | null {
  return findTextRangeAfter(doc, quote, after) ?? (hasEmphasis(quote) ? findTextRangeAfter(doc, plainOf(quote), after) : null)
}

// ---------- Anchors (lab switch ANCHOR): where the chat says the words stand ----------

type Range = { from: number; to: number }

/**
 * The paragraph an anchor names: by its paragraph id while that is still in the scene, else by its number as the
 * chat's read_scene counts them (paragraphs with words, scene breaks and empty ones left out). `start` and `end`
 * are the positions of its content's start and end. Null when there's no such paragraph.
 */
export function paragraphAt(doc: PMNode, a: ParaAnchor): { start: number; end: number } | null {
  let byPid: { start: number; end: number } | null = null
  let byNumber: { start: number; end: number } | null = null
  let n = 0
  doc.descendants((node, pos) => {
    if (byPid) return false
    if (!node.isTextblock) return true
    const here = { start: pos + 1, end: pos + 1 + node.content.size }
    if (a.pid && node.attrs.pid === a.pid) byPid = here
    if (node.textContent.trim() && ++n === a.paragraph) byNumber ??= here
    return false
  })
  return byPid ?? byNumber
}

/** Every place quoted words stand in one paragraph (with or without their *…* markers), in order. */
function hitsIn(doc: PMNode, quote: string, p: { start: number; end: number }): Range[] {
  const out: Range[] = []
  for (let at = p.start; ; ) {
    const r = findQuoteAfter(doc, quote, at)
    if (!r || r.from > p.end) return out
    out.push(r)
    at = r.from + 1
  }
}

/** Of several places, the one whose start (or end) is nearest `want`. */
const nearest = (hits: Range[], edge: 'from' | 'to', want: number): Range | null =>
  hits.reduce<Range | null>((best, h) => (!best || Math.abs(h[edge] - want) < Math.abs(best[edge] - want) ? h : best), null)

/**
 * Where quoted words stand by an anchor: in the paragraph it names, the place nearest its offset (their start; with
 * `edge` 'to', their end). Null when the paragraph is gone or doesn't have the words (then the words are searched
 * for as before).
 */
export function findQuoteAt(doc: PMNode, quote: string, a: ParaAnchor, edge: 'from' | 'to' = 'from'): Range | null {
  const p = paragraphAt(doc, a)
  return p ? nearest(hitsIn(doc, quote, p), edge, p.start + a.offset) : null
}

/** Where a passage stands by its anchors (start words at `at.start`, end words ending at `at.end`), else as before. */
export function findPassageAt(doc: PMNode, start: string, end: string, at?: { start: ParaAnchor; end: ParaAnchor }): Range | null {
  const s = at ? findQuoteAt(doc, start, at.start) : null
  if (!at || !s) return findPassage(doc, start, end)
  const p = paragraphAt(doc, at.end)
  const e = p ? nearest(hitsIn(doc, end, p).filter((h) => h.from >= s.from && h.to >= s.to), 'to', p.start + at.end.offset) : null
  const to = e ?? findEnd(doc, end, s)
  return to ? { from: s.from, to: to.to } : findPassage(doc, start, end)
}

/** Where a proposed edit's words are: by its anchor when it has one that still holds, else the first place they are. */
export const findEditAt = (doc: PMNode, find: string, at?: ParaAnchor): Range | null => (at ? findQuoteAt(doc, find, at) : null) ?? findQuote(doc, find)

/** A paragraph's words as inline content: *italics* and **bold** become marks; unpaired markers stay as they are. */
export function inlineNodes(schema: Schema, text: string): PMNode[] {
  const { italic, bold } = schema.marks
  return parseEmphasis(text)
    .filter((p) => p.text)
    .map((p) => schema.text(p.text, [...(p.bold && bold ? [bold.create()] : []), ...(p.italic && italic ? [italic.create()] : [])]))
}

/**
 * A change worked out for the document: [from, to) becomes `content` (a string is typed in, taking the marks of
 * the words it replaces). `first` and `count`: the scene's top-level paragraphs it touches.
 */
export interface PlannedEdit {
  from: number
  to: number
  content: Fragment | string
  first: number
  count: number
}

export type Plan = PlannedEdit | { why: string }

/**
 * An edit of words within one paragraph: the found words become `replace` (nothing, for a cut), typed in as plain
 * words that take the marks of the words they replace. The chat's edits never add or cross italics (those come as
 * rewrites), so an asterisk in them is just an asterisk.
 */
export function planText(doc: PMNode, find: string, replace: string, at?: ParaAnchor): Plan {
  const range = findEditAt(doc, find, at)
  if (!range) return { why: NOT_FOUND }
  const $from = doc.resolve(range.from)
  if ($from.depth !== 1 || !$from.parent.isTextblock) return { why: NOT_PLAIN }
  return { from: range.from, to: range.to, content: replace || Fragment.empty, first: $from.index(0), count: 1 }
}

/**
 * Where a passage's end words are: after its start words; else (a passage no longer than its start words, whose end
 * words are the start words' last ones) where they end with or after them. Never inside the start words alone.
 */
function findEnd(doc: PMNode, end: string, s: { from: number; to: number }): { from: number; to: number } | null {
  const after = findQuoteAfter(doc, end, s.to)
  if (after) return after
  const within = findQuoteAfter(doc, end, s.from)
  return within && within.to >= s.to ? within : null
}

/** Where a passage stands, from its start words to its end words, or null. */
export function findPassage(doc: PMNode, start: string, end: string): { from: number; to: number } | null {
  const s = findQuote(doc, start)
  const e = s ? findEnd(doc, end, s) : null
  return s && e ? { from: s.from, to: e.to } : null
}

/**
 * A passage rewritten across paragraphs: from its start words to its end words becomes the new paragraphs. The words
 * before the start and after the end in their paragraphs stay, joined to the first and last new paragraph. Refused
 * when the passage runs across anything that isn't a paragraph (a scene break).
 */
export function planPassage(doc: PMNode, start: string, end: string, replace: string, at?: { start: ParaAnchor; end: ParaAnchor }): Plan {
  const found = findPassageAt(doc, start, end, at)
  if (!found) return { why: NOT_FOUND }
  const $a = doc.resolve(found.from)
  const $b = doc.resolve(found.to)
  if ($a.depth !== 1 || $b.depth !== 1) return { why: NOT_PLAIN }
  const first = $a.index(0)
  const last = $b.index(0)
  for (let i = first; i <= last; i++) if (doc.child(i).type !== $a.parent.type) return { why: NOT_PLAIN }
  const schema = doc.type.schema
  const texts = replace
    .split(/\n\s*\n/)
    .map((t) => t.replace(/\s*\n\s*/g, ' ').trim())
    .filter(Boolean)
  // Nothing in place of the passage: the words around it are still kept, in one paragraph.
  if (!texts.length) texts.push('')
  const lastNew = texts.length - 1
  const nodes = texts.map((t, i) => {
    let content = Fragment.from(inlineNodes(schema, t))
    if (i === 0) content = $a.parent.content.cut(0, $a.parentOffset).append(content)
    if (i === lastNew) content = content.append($b.parent.content.cut($b.parentOffset))
    // The first keeps its paragraph's id; the rest get fresh ones (paragraphIds.ts).
    const attrs = i === 0 ? $a.parent.attrs : { ...$a.parent.attrs, pid: null }
    return $a.parent.type.create(attrs, content)
  })
  return { from: $a.before(1), to: $b.after(1), content: Fragment.from(nodes), first, count: last - first + 1 }
}

// ---------- Inserts and cuts (lab switch TEXTTOOLS): whole paragraphs, found by their anchors ----------

export const INSERT_GONE =
  'The paragraph this insert goes next to isn’t in the scene any more: another change or your own editing changed it. Ask again for a fresh one.'
export const CUT_CHANGED =
  'The paragraphs this cut takes out aren’t in the scene as they were: another change or your own editing changed them, so nothing was cut. Ask again for a fresh one.'
export const CUT_PLAIN = 'This cut runs across a scene break (or something that isn’t a paragraph), so it wasn’t applied.'
export const CUT_ALL = 'This cut would take out every paragraph of the scene, so it wasn’t applied.'

/** Words compared as the page has them: emphasis markers and every space or line break left out. */
const bare = (s: string): string => plainOf(s).replace(/\s+/g, '')

/**
 * The scene's top-level paragraph an anchor names: by its id while that is in the scene; else (no id, or the id gone)
 * by its number when it still reads `words`, else the one paragraph that reads `words`. Null when none does.
 */
export function blockAt(doc: PMNode, a: ParaAnchor, words: string): number | null {
  let byPid: number | null = null
  let byNumber: number | null = null
  const reading: number[] = []
  let n = 0
  const want = bare(words)
  doc.forEach((c, _o, i) => {
    if (a.pid && byPid === null && pidOf(c) === a.pid) byPid = i
    if (!c.isTextblock || !c.textContent.trim()) return
    if (++n === a.paragraph) byNumber = i
    if (bare(c.textContent) === want) reading.push(i)
  })
  if (byPid !== null) return byPid
  if (byNumber !== null && bare(doc.child(byNumber).textContent) === want) return byNumber
  return reading.length === 1 ? reading[0] : null
}

/** New paragraphs after (or before) the one the anchor names, each a blank line apart in `text`, *italics* kept. */
export function planInsert(doc: PMNode, p: { where: 'after' | 'before'; at: ParaAnchor; near: string; text: string }): Plan {
  const i = blockAt(doc, p.at, p.near)
  if (i === null) return { why: INSERT_GONE }
  const block = doc.child(i)
  if (!block.isTextblock) return { why: NOT_PLAIN }
  const schema = doc.type.schema
  const texts = p.text
    .split(/\n\s*\n/)
    .map((t) => t.replace(/\s*\n\s*/g, ' ').trim())
    .filter(Boolean)
  if (!texts.length) return { why: 'This insert has no words to put in.' }
  // Paragraphs like the one beside them, each with a fresh id (paragraphIds.ts).
  const nodes = texts.map((t) => block.type.create({ ...block.attrs, pid: null }, inlineNodes(schema, t)))
  const at = p.where === 'after' ? i + 1 : i
  const pos = childPos(doc, at)
  return { from: pos, to: pos, content: Fragment.from(nodes), first: at, count: 0 }
}

/** Whole paragraphs out, from the one `from` names to the one `to` names, only while they read as they did. */
export function planCut(doc: PMNode, p: { from: ParaAnchor; to: ParaAnchor; paragraphs: string[] }): Plan {
  if (!p.paragraphs.length) return { why: CUT_CHANGED }
  const a = blockAt(doc, p.from, p.paragraphs[0])
  const b = blockAt(doc, p.to, p.paragraphs[p.paragraphs.length - 1])
  if (a === null || b === null || b < a) return { why: CUT_CHANGED }
  const type = doc.child(a).type
  const words: string[] = []
  for (let i = a; i <= b; i++) {
    const c = doc.child(i)
    if (c.type !== type) return { why: CUT_PLAIN }
    if (c.textContent.trim()) words.push(bare(c.textContent))
  }
  // Every paragraph in between still reads as it did: nothing Adam wrote since is cut.
  if (words.length !== p.paragraphs.length || words.some((w, k) => w !== bare(p.paragraphs[k]))) return { why: CUT_CHANGED }
  if (a === 0 && b === doc.childCount - 1) return { why: CUT_ALL }
  return { from: childPos(doc, a), to: childPos(doc, b + 1), content: Fragment.empty, first: a, count: b - a + 1 }
}

/** What an applied change did to the scene: its top-level paragraphs as they were, and as they became. */
export interface BlockChange {
  before: PMNode[]
  after: PMNode[]
  /**
   * The paragraphs either side of what the change left, as it left them (a cut leaves nothing, TEXTTOOLS): Undo puts
   * the cut paragraphs back after `prev` (found by its id, so Adam's typing in it since doesn't matter), else before
   * `next`. Null at the scene's start or end.
   */
  prev?: PMNode | null
  next?: PMNode | null
}

const children = (doc: PMNode, from: number, count: number): PMNode[] => {
  const out: PMNode[] = []
  for (let i = from; i < from + count && i < doc.childCount; i++) out.push(doc.child(i))
  return out
}

/** The change made by a planned edit, from the document before it and the document after (ids given, say). */
export function changeOf(before: PMNode, after: PMNode, plan: PlannedEdit): BlockChange {
  const grown = after.childCount - before.childCount
  const made = children(after, plan.first, plan.count + grown)
  const end = plan.first + made.length
  return {
    before: children(before, plan.first, plan.count),
    after: made,
    prev: plan.first > 0 ? after.child(plan.first - 1) : null,
    next: end < after.childCount ? after.child(end) : null
  }
}

const pidOf = (n: PMNode): string | null => (n.attrs.pid as string | null | undefined) ?? null
const contentKey = (n: PMNode): string => `${n.type.name}|${JSON.stringify(n.content.toJSON() ?? [])}`

function runAt(doc: PMNode, at: number, blocks: PMNode[]): boolean {
  if (at < 0 || at + blocks.length > doc.childCount) return false
  return blocks.every((b, k) => contentKey(doc.child(at + k)) === contentKey(b))
}

/**
 * Where these paragraphs stand in the document, one after another and word for word (index of the first), or null.
 * When the first carries a paragraph id that is still in the scene, only that place counts, so a paragraph that
 * happens to read the same elsewhere is never taken for it.
 */
export function locateBlocks(doc: PMNode, blocks: PMNode[]): number | null {
  if (!blocks.length) return null
  const pid = pidOf(blocks[0])
  if (pid) {
    let at = -1
    doc.forEach((c, _o, i) => {
      if (at < 0 && pidOf(c) === pid) at = i
    })
    if (at >= 0) return runAt(doc, at, blocks) ? at : null
  }
  const hits: number[] = []
  for (let i = 0; i + blocks.length <= doc.childCount; i++) if (runAt(doc, i, blocks)) hits.push(i)
  return hits.length === 1 ? hits[0] : null
}

/** How to put a change back: [from, to) becomes `content`; or why not ('already': it is back already). */
export type RevertPlan = { from: number; to: number; content: Fragment } | { why: 'already' | 'changed' }

/** A paragraph's place in the document: by its id while that is there (whatever its words now), else by its words. */
function indexOf(doc: PMNode, block: PMNode): number | null {
  const pid = pidOf(block)
  if (pid) {
    let at: number | null = null
    doc.forEach((c, _o, i) => {
      if (at === null && pidOf(c) === pid) at = i
    })
    return at
  }
  return locateBlocks(doc, [block])
}

/** The position before the document's child `i` (its end, for i = childCount). */
const childPos = (doc: PMNode, i: number): number => {
  let pos = 0
  for (let k = 0; k < i; k++) pos += doc.child(k).nodeSize
  return pos
}

export function planRevert(doc: PMNode, change: BlockChange): RevertPlan {
  const schema = doc.type.schema
  // A cut (TEXTTOOLS): its paragraphs go back between the ones either side, unless they are back already.
  if (!change.after.length) {
    if (!change.before.length || locateBlocks(doc, change.before) !== null) return { why: 'already' }
    const prev = change.prev ? indexOf(doc, change.prev) : null
    const next = prev === null && change.next ? indexOf(doc, change.next) : null
    const i = prev !== null ? prev + 1 : next !== null ? next : !change.prev && !change.next ? 0 : null
    if (i === null) return { why: 'changed' }
    const pos = childPos(doc, i)
    return { from: pos, to: pos, content: Fragment.from(change.before.map((n) => schema.nodeFromJSON(n.toJSON()))) }
  }
  const at = locateBlocks(doc, change.after)
  if (at === null) {
    // New paragraphs only (an insert, TEXTTOOLS): gone altogether is undone already; still there, changed since.
    if (!change.before.length) {
      const pid = pidOf(change.after[0])
      return { why: pid && indexOf(doc, change.after[0]) === null ? 'already' : 'changed' }
    }
    return { why: locateBlocks(doc, change.before) !== null ? 'already' : 'changed' }
  }
  let from = 0
  for (let i = 0; i < at; i++) from += doc.child(i).nodeSize
  let to = from
  for (let i = at; i < at + change.after.length; i++) to += doc.child(i).nodeSize
  // The paragraphs may come from another editor's schema (the page's, for the saved scene): rebuilt in this one.
  const content = Fragment.from(change.before.map((n) => schema.nodeFromJSON(n.toJSON())))
  return { from, to, content }
}

/** The document with a change put back (for a saved scene), or why not. */
export function revertDoc(doc: PMNode, change: BlockChange): PMNode | { why: 'already' | 'changed' } {
  const r = planRevert(doc, change)
  if ('why' in r) return r
  return doc.replace(r.from, r.to, new Slice(r.content, 0, 0))
}

// ---------- A proposed draft (lab switch DRAFT): where the writer's own job starts ----------

/**
 * Where Continue carries on for a proposed draft: the end of the paragraph its anchor names (while it is there), else
 * the end of the scene's last paragraph with words. Null when the scene has no words to carry on from.
 */
export function continueAt(doc: PMNode, at?: ParaAnchor): number | null {
  const p = at ? paragraphAt(doc, at) : null
  if (p) return p.end
  let last: number | null = null
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true
    if (node.textContent.trim()) last = pos + 1 + node.content.size
    return false
  })
  return last
}

/**
 * Which beat Beat by beat calls a proposed beat: its number among the card's beats with words (blank ones don't count
 * there), found by its words first (the card may have changed since), else by its place on the card (from 1). Null
 * when the card no longer has it.
 */
export function beatNumber(cardBeats: readonly string[], beat: { index: number; text: string }): number | null {
  const filled = cardBeats.map((b, i) => ({ b: b.trim(), i })).filter((x) => x.b)
  const byWords = filled.findIndex((x) => x.b === beat.text.trim())
  if (byWords >= 0) return byWords + 1
  const byPlace = filled.findIndex((x) => x.i === beat.index - 1)
  return byPlace >= 0 ? byPlace + 1 : null
}
