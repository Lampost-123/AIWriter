// The page, for step 3's check and repair: what the window would hold once new AI words land (the scene so far, then
// the new paragraphs), in a ProseMirror document like the editor's (paragraphs with a `pid`, line breaks as hard
// breaks), so the app's own pure page code (features/repair/apply.ts: landedParts, fixesTr) can find the new words
// and make the fixes exactly as the window does. When a checkout has the repair but not that file, `mirrorFixes` makes
// the same edits on plain text.

import { Schema, type Node as PMNode } from '@tiptap/pm/model'
import { EditorState, TextSelection } from '@tiptap/pm/state'

/** A schema with just what the editor's scene documents need here: paragraphs with an id, text, hard breaks. */
export const pageSchema = new Schema({
  nodes: {
    doc: { content: 'paragraph+' },
    paragraph: { content: 'inline*', group: 'block', attrs: { pid: { default: null } } },
    text: { group: 'inline' },
    hardBreak: { inline: true, group: 'inline', selectable: false }
  }
})

/** A passage's paragraphs, as the page shows them: split at blank lines (a single line break stays inside). */
export const paragraphsOf = (text: string): string[] =>
  text
    .replace(/\r\n?/g, '\n')
    .split(/\n[ \t]*\n+/)
    .map((p) => p.trim())
    .filter(Boolean)

function paragraph(text: string, pid: string): PMNode {
  const parts: PMNode[] = []
  text.split('\n').forEach((line, i) => {
    if (i > 0) parts.push(pageSchema.nodes.hardBreak.create())
    if (line) parts.push(pageSchema.text(line))
  })
  return pageSchema.nodes.paragraph.create({ pid }, parts)
}

export interface Page {
  /** The page with Adam's cursor at its end (where it is when new words land below his). */
  state: EditorState
  /** Where the new words begin (the position just before their first paragraph). */
  from: number
  /** How many paragraphs come before the new words. */
  before: number
}

/** The page once new words land: the paragraphs before, then the new ones, each with its own id. */
export function landedPage(before: string[], added: string[], pid: (index: number) => string): Page {
  const nodes = [...before, ...added].map((t, i) => paragraph(t, pid(i)))
  const doc = pageSchema.nodes.doc.create(null, nodes.length ? nodes : [pageSchema.nodes.paragraph.create({ pid: pid(0) })])
  let from = 0
  for (let i = 0; i < before.length; i++) from += doc.child(i).nodeSize
  const state = EditorState.create({ doc, selection: TextSelection.atEnd(doc) })
  return { state, from, before: before.length }
}

/** A paragraph's words, a hard break as "\n" (as apply.ts reads them). */
function textOf(node: PMNode): string {
  let t = ''
  node.forEach((child) => {
    t += child.isText ? (child.text ?? '') : child.type.name === 'hardBreak' ? '\n' : ''
  })
  return t
}

/** The words from paragraph `start` on, a blank line between paragraphs (the new words, after any fixes). */
export function wordsFrom(doc: PMNode, start: number): string {
  const out: string[] = []
  doc.forEach((node, _offset, i) => {
    if (i >= start) out.push(textOf(node))
  })
  return out.join('\n\n')
}

export interface Fix {
  id: string
  para: number
  start: number
  end: number
  was: string
  now: string
}

/**
 * The fixes on plain paragraphs, as apply.ts makes them when nothing is in the way: only inside the AI's part of its
 * paragraph, only where the words still say what the AI wrote, never two in one place. Returns the new paragraph
 * texts and the ids made.
 */
export function mirrorFixes(parts: { text: string; from: number; to: number }[], fixes: Fix[]): { texts: string[]; made: string[] } {
  const texts = parts.map((p) => p.text)
  const taken: { para: number; start: number; end: number }[] = []
  const made: string[] = []
  const ok = fixes.filter((f) => {
    const part = parts[f.para]
    if (!part || f.start < part.from || f.end > part.to || f.end <= f.start || part.text.slice(f.start, f.end) !== f.was) return false
    if (taken.some((t) => t.para === f.para && t.start < f.end && f.start < t.end)) return false
    taken.push(f)
    made.push(f.id)
    return true
  })
  for (const f of [...ok].sort((a, b) => b.para - a.para || b.start - a.start)) {
    texts[f.para] = texts[f.para].slice(0, f.start) + f.now + texts[f.para].slice(f.end)
  }
  return { texts, made }
}
