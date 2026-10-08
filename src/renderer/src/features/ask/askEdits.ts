// The editor chat's changes to a scene's words, worked out on documents alone (no editor, no window), so they are
// unit-tested. applyProposal.ts makes them in the page; Undo puts back exactly what one changed:
//  - Applying records the scene's paragraphs it touched, as they were and as they became.
//  - Undo finds those paragraphs as they became (by the first one's paragraph id) and puts the old ones back, in the
//    page when the scene is open, else in the saved scene. When Adam has changed them since, nothing is touched.
//  - The chat reads italics as *…* (and bold as **…**): quoted words are found with or without the markers, and new
//    words with them get italics (or bold) as a streamed draft's do (streamText.parseEmphasis).
import { Fragment, Slice, type Node as PMNode, type Schema } from '@tiptap/pm/model'
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
export function planText(doc: PMNode, find: string, replace: string): Plan {
  const range = findQuote(doc, find)
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
export function planPassage(doc: PMNode, start: string, end: string, replace: string): Plan {
  const found = findPassage(doc, start, end)
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

/** What an applied change did to the scene: its top-level paragraphs as they were, and as they became. */
export interface BlockChange {
  before: PMNode[]
  after: PMNode[]
}

const children = (doc: PMNode, from: number, count: number): PMNode[] => {
  const out: PMNode[] = []
  for (let i = from; i < from + count && i < doc.childCount; i++) out.push(doc.child(i))
  return out
}

/** The change made by a planned edit, from the document before it and the document after (ids given, say). */
export function changeOf(before: PMNode, after: PMNode, plan: PlannedEdit): BlockChange {
  const grown = after.childCount - before.childCount
  return { before: children(before, plan.first, plan.count), after: children(after, plan.first, plan.count + grown) }
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

export function planRevert(doc: PMNode, change: BlockChange): RevertPlan {
  const at = locateBlocks(doc, change.after)
  if (at === null) return { why: locateBlocks(doc, change.before) !== null ? 'already' : 'changed' }
  let from = 0
  for (let i = 0; i < at; i++) from += doc.child(i).nodeSize
  let to = from
  for (let i = at; i < at + change.after.length; i++) to += doc.child(i).nodeSize
  // The paragraphs may come from another editor's schema (the page's, for the saved scene): rebuilt in this one.
  const schema = doc.type.schema
  const content = Fragment.from(change.before.map((n) => schema.nodeFromJSON(n.toJSON())))
  return { from, to, content }
}

/** The document with a change put back (for a saved scene), or why not. */
export function revertDoc(doc: PMNode, change: BlockChange): PMNode | { why: 'already' | 'changed' } {
  const r = planRevert(doc, change)
  if ('why' in r) return r
  return doc.replace(r.from, r.to, new Slice(r.content, 0, 0))
}
