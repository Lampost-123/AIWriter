// An imported scene's paragraphs as the editor saves a scene: a TipTap document whose paragraphs each carry a
// stable id (`pid`, as features/editor/paragraphIds.ts gives them), with bold and italic marks, line breaks
// as hard breaks and scene breaks as horizontal rules; and the scene's plain text exactly as the editor
// writes it (streamDoc.sceneText: blocks joined by blank lines, a break as "* * *"). So the editor, History,
// search and the memory keeper (keeper/text.ts reads the ids and hashes) treat it like a typed scene. Pure.

import { randomBytes } from 'node:crypto'
import type { ManuscriptRun } from '@shared/contracts/importing'

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'
const ID_LENGTH = 8

/** A short random paragraph id that isn't in `taken`, like the editor's own. */
export function paragraphId(taken: Set<string>): string {
  for (;;) {
    const bytes = randomBytes(ID_LENGTH)
    let id = ''
    for (const b of bytes) id += ALPHABET[b % ALPHABET.length]
    if (!taken.has(id)) {
      taken.add(id)
      return id
    }
  }
}

type Mark = { type: 'bold' } | { type: 'italic' }
type Inline = { type: 'text'; text: string; marks?: Mark[] } | { type: 'hardBreak'; marks?: Mark[] }
type Block = { type: 'paragraph'; attrs: { pid: string }; content?: Inline[] } | { type: 'horizontalRule' }

export interface SceneDoc {
  doc: { type: 'doc'; content: Block[] } | null
  text: string
}

/** One paragraph's inline content: text with its marks (bold before italic, as the editor's schema orders them), '\n' as hard breaks. */
function inline(runs: ManuscriptRun[]): Inline[] {
  const out: Inline[] = []
  for (const r of runs) {
    const marks: Mark[] = [...(r.bold ? [{ type: 'bold' } as const] : []), ...(r.italic ? [{ type: 'italic' } as const] : [])]
    const withMarks = marks.length ? { marks } : {}
    r.text.split('\n').forEach((part, i) => {
      if (i > 0) out.push({ type: 'hardBreak', ...withMarks })
      if (!part) return
      const last = out[out.length - 1]
      // Next to text with the same marks, it joins it (the editor never keeps two such text nodes side by side).
      if (last?.type === 'text' && JSON.stringify(last.marks ?? []) === JSON.stringify(marks)) last.text += part
      else out.push({ type: 'text', text: part, ...withMarks })
    })
  }
  return out
}

/** The editor's text of one paragraph: its words, a hard break as a new line. */
const paraText = (runs: ManuscriptRun[]): string => runs.map((r) => r.text).join('')

/**
 * A scene's document and text from its paragraphs (an empty paragraph list is a scene break inside the scene).
 * A scene with no words has no document, like a new scene.
 */
export function sceneDoc(paragraphs: ManuscriptRun[][]): SceneDoc {
  const taken = new Set<string>()
  const content: Block[] = []
  const texts: string[] = []
  for (const p of paragraphs) {
    if (!p.length) {
      if (content.length && content[content.length - 1].type !== 'horizontalRule') {
        content.push({ type: 'horizontalRule' })
        texts.push('* * *')
      }
      continue
    }
    const text = paraText(p)
    if (!text.trim()) continue
    content.push({ type: 'paragraph', attrs: { pid: paragraphId(taken) }, content: inline(p) })
    texts.push(text)
  }
  while (content.length && content[content.length - 1].type === 'horizontalRule') {
    content.pop()
    texts.pop()
  }
  if (!content.length) return { doc: null, text: '' }
  return { doc: { type: 'doc', content }, text: texts.join('\n\n') }
}
