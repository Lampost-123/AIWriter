// Picking from a set of variants. Each variant's text as the blocks it would make in the page (laid out
// as Generate lays out a draft), the paragraphs Adam picks from any of them, in the order he picks them,
// and the scene's whole new text for "Replace it" or "Add below". Pure (no React, no editor), so it is
// unit-tested.

import type { ID } from '@shared/types'
import { countWords } from '@shared/defaults'
import { isPreambleLine, isSceneBreakLine, parseEmphasis, splitParagraphs, type MarkedPiece } from '@/features/editor/streamText'

/** One block of a variant as it would go into the page: a paragraph (with its italics and bold) or a scene break. */
export type VariantBlock = { kind: 'paragraph'; pieces: MarkedPiece[] } | { kind: 'break' }

/**
 * A variant's text as the blocks it would make in the page, as Generate lays out a draft: a paragraph
 * per line, "***" lines as scene breaks, the model's *asterisks* as italics and **pairs** as bold, and a
 * heading or lead-in ("Here's the scene:") left out once the scene's first real line follows it.
 */
export function variantBlocks(text: string): VariantBlock[] {
  const paragraphs = splitParagraphs(text).filter((p) => p.trim() !== '')
  if (paragraphs.length > 1 && isPreambleLine(paragraphs[0])) paragraphs.shift()
  return paragraphs.map((p) => (isSceneBreakLine(p) ? { kind: 'break' } : { kind: 'paragraph', pieces: parseEmphasis(p) }))
}

/** A paragraph's words, without its markup. */
export const paragraphText = (b: VariantBlock): string => (b.kind === 'paragraph' ? b.pieces.map((p) => p.text).join('') : '')

/** How many words the blocks hold. */
export const blocksWords = (blocks: VariantBlock[]): number => blocks.reduce((n, b) => n + countWords(paragraphText(b)), 0)

// ---------- Picking paragraphs ----------

/** A picked paragraph: the variant it comes from (its draft) and which of its blocks it is. */
export interface Pick {
  generationId: ID
  block: number
}

const same = (a: Pick, b: Pick): boolean => a.generationId === b.generationId && a.block === b.block

/** Picks a paragraph, or unpicks it when it is picked already. A new pick goes last; the others keep their order. */
export function togglePick(picks: Pick[], pick: Pick): Pick[] {
  return picks.some((p) => same(p, pick))
    ? picks.filter((p) => !same(p, pick))
    : [...picks, { generationId: pick.generationId, block: pick.block }]
}

/** Where a paragraph comes in the picked text, from 1; 0 when it isn't picked. */
export const pickNumber = (picks: Pick[], pick: Pick): number => picks.findIndex((p) => same(p, pick)) + 1

/** The picked paragraphs, in the order they were picked (one whose variant or paragraph is gone is left out). */
export function pickedBlocks(picks: Pick[], blocksOf: (generationId: ID) => VariantBlock[] | undefined): VariantBlock[] {
  const out: VariantBlock[] = []
  for (const p of picks) {
    const b = blocksOf(p.generationId)?.[p.block]
    if (b?.kind === 'paragraph') out.push(b)
  }
  return out
}

// ---------- The scene's new text ----------

/** A node of a stored scene document (ProseMirror's JSON). */
export interface DocNode {
  type: string
  attrs?: Record<string, unknown>
  content?: DocNode[]
  marks?: { type: string; attrs?: Record<string, unknown> }[]
  text?: string
}

export interface SceneDoc {
  type: 'doc'
  content: DocNode[]
}

/** The page's blocks for these variant blocks: paragraphs (their ids are added as they go in) and scene breaks. */
export function blocksToNodes(blocks: VariantBlock[]): DocNode[] {
  return blocks.map((b) => {
    if (b.kind === 'break') return { type: 'horizontalRule' }
    const content = b.pieces
      .filter((p) => p.text)
      .map((p): DocNode => {
        const marks = [...(p.bold ? [{ type: 'bold' }] : []), ...(p.italic ? [{ type: 'italic' }] : [])]
        return marks.length ? { type: 'text', text: p.text, marks } : { type: 'text', text: p.text }
      })
    return content.length ? { type: 'paragraph', content } : { type: 'paragraph' }
  })
}

/** Plain text of a stored document, as the scene keeps it: paragraphs apart by a blank line, scene breaks as "* * *". */
export function docText(nodes: DocNode[]): string {
  const blocks: string[] = []
  const visit = (node: DocNode): void => {
    if (node.type === 'horizontalRule') {
      blocks.push('* * *')
      return
    }
    const kids = node.content ?? []
    if (node.type === 'paragraph' || node.type === 'heading') {
      const t = kids.map((k) => (k.type === 'text' ? (k.text ?? '') : k.type === 'hardBreak' ? '\n' : '')).join('')
      if (t.trim()) blocks.push(t)
      return
    }
    kids.forEach(visit)
  }
  nodes.forEach(visit)
  return blocks.join('\n\n')
}

const isDocNode = (n: unknown): n is DocNode => !!n && typeof n === 'object' && typeof (n as DocNode).type === 'string'

/** The page's blocks from its stored form: the document, else the plain text (one paragraph per line). */
function nodesOf(current: { doc: unknown; text: string }): DocNode[] {
  const doc = current.doc as { type?: unknown; content?: unknown } | null
  if (doc && typeof doc === 'object' && doc.type === 'doc' && Array.isArray(doc.content) && doc.content.every(isDocNode)) {
    return doc.content as DocNode[]
  }
  return splitParagraphs(current.text ?? '').map((p) =>
    isSceneBreakLine(p) ? { type: 'horizontalRule' } : { type: 'paragraph', content: [{ type: 'text', text: p }] }
  )
}

/** A paragraph with no words in it. */
const isBlank = (n: DocNode): boolean => n.type === 'paragraph' && !docText([n]).trim()

/** Where the new text goes in a scene that already has text: in place of it, or after it, below a scene break. */
export type UseMode = 'replace' | 'add'

/**
 * The scene's whole new text, as a stored document and its plain text. Replace it (or a scene with no
 * words yet): just the new blocks. Add below: the scene as it is now (`current`, without the empty lines
 * at its end), a scene break (unless one is there already), then the new blocks.
 */
export function sceneWith(
  mode: UseMode,
  blocks: VariantBlock[],
  current: { doc: unknown; text: string } | null
): { doc: SceneDoc; text: string } {
  const added = blocksToNodes(blocks)
  let content = added
  if (mode === 'add' && current) {
    const kept = [...nodesOf(current)]
    while (kept.length && isBlank(kept[kept.length - 1])) kept.pop()
    if (docText(kept).trim()) {
      const breakThere = kept[kept.length - 1]?.type === 'horizontalRule' || added[0]?.type === 'horizontalRule'
      content = [...kept, ...(breakThere ? [] : [{ type: 'horizontalRule' }]), ...added]
    }
  }
  if (!content.length) content = [{ type: 'paragraph' }]
  return { doc: { type: 'doc', content }, text: docText(content) }
}
