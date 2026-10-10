// The chapter writer's pages, built in the main process as the editor would save them (importing/doc.ts's form: a
// TipTap document whose paragraphs carry stable ids, italics and bold as marks, scene breaks as rules; and the plain
// text the editor writes: blocks a blank line apart, a break as "* * *"). A paragraph whose words didn't change keeps
// its old node whole, id, marks and all, so the memory's source links, beat markers and speaker marks stay with it;
// only new or changed paragraphs get new ids. Pure.

import { parseEmphasis } from '@shared/emphasis'
import { paragraphId } from '../importing/doc'

type Mark = { type: string }
type Inline = { type: 'text'; text: string; marks?: Mark[] } | { type: 'hardBreak'; marks?: Mark[] }
export type PageBlock = { type: 'paragraph'; attrs: { pid: string }; content?: Inline[] } | { type: 'horizontalRule' }
export interface Page {
  doc: { type: 'doc'; content: PageBlock[] } | null
  text: string
}

type AnyNode = { type?: string; text?: string; attrs?: { pid?: unknown }; marks?: Mark[]; content?: AnyNode[] }

/** A line that is only a scene break: "* * *", "***", "---", "#". */
const BREAK_LINE = /^\s*(?:\*\s*\*\s*\*[\s*]*|-{3,}|_{3,}|#)\s*$/

/** One paragraph's words, as the page's plain text has them (a hard break as a new line). */
function blockText(n: AnyNode): string {
  let t = ''
  for (const c of n.content ?? []) {
    if (c.type === 'text' && typeof c.text === 'string') t += c.text
    else if (c.type === 'hardBreak') t += '\n'
  }
  return t
}

/** A page's blocks, each with its plain text. Anything but paragraphs and rules is read as a paragraph of its words. */
function oldBlocks(doc: unknown): { node: AnyNode; text: string; pid: string | null }[] {
  const root = doc && typeof doc === 'object' ? (doc as AnyNode) : null
  const out: { node: AnyNode; text: string; pid: string | null }[] = []
  for (const n of root?.content ?? []) {
    if (n.type === 'horizontalRule') continue
    const text = blockText(n)
    if (!text.trim()) continue
    const pid = typeof n.attrs?.pid === 'string' && n.attrs.pid ? n.attrs.pid : null
    out.push({ node: n, text, pid })
  }
  return out
}

/** One paragraph's inline content from words with *asterisks* for italics (and **bold**); '\n' as hard breaks. */
function inlineOf(words: string): Inline[] {
  const out: Inline[] = []
  for (const piece of parseEmphasis(words)) {
    const marks: Mark[] = [...(piece.bold ? [{ type: 'bold' }] : []), ...(piece.italic ? [{ type: 'italic' }] : [])]
    const withMarks = marks.length ? { marks } : {}
    piece.text.split('\n').forEach((part, i) => {
      if (i > 0) out.push({ type: 'hardBreak', ...withMarks })
      if (!part) return
      const last = out[out.length - 1]
      if (last?.type === 'text' && JSON.stringify(last.marks ?? []) === JSON.stringify(marks)) last.text += part
      else out.push({ type: 'text', text: part, ...withMarks })
    })
  }
  return out
}

/** Plain words of marked words (the asterisks taken out where they pair up). */
export const plainOf = (marked: string): string =>
  parseEmphasis(marked)
    .map((p) => p.text)
    .join('')

/**
 * Splits prose into its blocks: paragraphs a blank line apart (with `lines: 'paragraphs'`, any line break starts a new
 * paragraph, as a streamed draft does), scene-break lines as breaks. Leading and trailing breaks are dropped.
 */
export function proseBlocks(prose: string, lines: 'paragraphs' | 'breaks' = 'breaks'): ({ rule: true } | { rule: false; words: string })[] {
  const norm = prose.replace(/\r\n?/g, '\n')
  const parts = (lines === 'paragraphs' ? norm.split(/\n+/) : norm.split(/\n[ \t]*\n+/)).map((p) => p.replace(/^[ \t]+|[ \t]+$/g, ''))
  const out: ({ rule: true } | { rule: false; words: string })[] = []
  for (const part of parts) {
    if (!part.trim()) continue
    if (BREAK_LINE.test(part)) {
      if (out.length && !out[out.length - 1].rule) out.push({ rule: true })
      continue
    }
    // Inside a paragraph, a line break is a hard break; trailing spaces on each line go.
    out.push({ rule: false, words: part.split('\n').map((l) => l.trim()).join('\n') })
  }
  while (out.length && out[out.length - 1].rule) out.pop()
  return out
}

/**
 * A page from prose with *asterisks* for italics. A paragraph whose plain words are exactly an old paragraph's (each
 * old one used once, in order of first match) keeps the old node, so its id and marks stay; every other paragraph gets
 * a new id no other paragraph has.
 */
export function pageFrom(prose: string, old: unknown = null, lines: 'paragraphs' | 'breaks' = 'breaks'): Page {
  const before = oldBlocks(old)
  const used = new Set<number>()
  const taken = new Set(before.flatMap((b) => (b.pid ? [b.pid] : [])))
  const content: PageBlock[] = []
  const texts: string[] = []
  for (const b of proseBlocks(prose, lines)) {
    if (b.rule) {
      content.push({ type: 'horizontalRule' })
      texts.push('* * *')
      continue
    }
    const inline = inlineOf(b.words)
    const text = inline.map((i) => (i.type === 'text' ? i.text : '\n')).join('')
    if (!text.trim()) continue
    const same = before.findIndex((o, i) => !used.has(i) && o.pid && o.text === text)
    if (same >= 0) {
      used.add(same)
      content.push(before[same].node as PageBlock)
    } else {
      content.push({ type: 'paragraph', attrs: { pid: paragraphId(taken) }, content: inline })
    }
    texts.push(text)
  }
  if (!content.length) return { doc: null, text: '' }
  return { doc: { type: 'doc', content }, text: texts.join('\n\n') }
}

/** The words a model wrote, tidied for the page: its own notes before or after the prose are the caller's to cut. */
export function cleanProse(reply: string): string {
  let t = reply.replace(/\r\n?/g, '\n').trim()
  // A reply wrapped in a code fence.
  const fence = /^```[a-z]*\n([\s\S]*?)\n```$/i.exec(t)
  if (fence) t = fence[1].trim()
  return t
}
