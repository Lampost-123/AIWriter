// Writing by hand: the words that count as correct in the page (the open world's names, aliases and glossary terms,
// and Adam's own "Add to dictionary" words). Chromium's checker doesn't know them, and they are never put into its
// dictionary (on Windows and macOS that is the system's, shared with every other program). Instead each one in the
// page is marked (an inline decoration with the class `aiwrite-known-word`) and spelling.css hides Chromium's
// underline on it with ::spelling-error.
import { Extension } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'
import { knownWordRanges } from '@shared/spelling'
import './spelling.css'

export const KNOWN_WORD_CLASS = 'aiwrite-known-word'

/** The words that count as correct now (lower case), set by install.ts from the main process. */
let known: ReadonlySet<string> = new Set()
const views = new Set<EditorView>()

export const knownWordsKey = new PluginKey<DecorationSet>('aiwriteKnownWords')

/** New words that count as correct: every page marks them again. */
export function setKnownWords(words: string[]): void {
  const next = new Set(words.map((w) => w.toLocaleLowerCase()))
  if (next.size === known.size && [...next].every((w) => known.has(w))) return
  known = next
  for (const v of views) if (!v.isDestroyed) v.dispatch(v.state.tr.setMeta(knownWordsKey, 'all').setMeta('addToHistory', false))
}

/** The marks for the known words in one paragraph (at `pos`). */
function marksIn(block: PMNode, pos: number): Decoration[] {
  if (!block.isTextblock || !known.size) return []
  // Inline nodes other than text are one character, as a space, so offsets match positions.
  const text = block.textBetween(0, block.content.size, undefined, ' ')
  return knownWordRanges(text, known).map((r) => Decoration.inline(pos + 1 + r.from, pos + 1 + r.to, { class: KNOWN_WORD_CLASS }))
}

/** The marks for a whole page. */
export function knownWordMarks(doc: PMNode): DecorationSet {
  const decos: Decoration[] = []
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true
    decos.push(...marksIn(node, pos))
    return false
  })
  return DecorationSet.create(doc, decos)
}

/** The paragraphs a change touched (in the new page), so only they are looked at again. */
function touchedBlocks(tr: Transaction): { from: number; to: number } | null {
  let from = Infinity
  let to = -Infinity
  tr.mapping.maps.forEach((map, i) => {
    map.forEach((_a, _b, start, end) => {
      // Into the final page's positions.
      const rest = tr.mapping.slice(i + 1)
      from = Math.min(from, rest.map(start, -1))
      to = Math.max(to, rest.map(end, 1))
    })
  })
  return from <= to ? { from, to } : null
}

function apply(tr: Transaction, set: DecorationSet, _old: EditorState, state: EditorState): DecorationSet {
  if (tr.getMeta(knownWordsKey) === 'all') return knownWordMarks(state.doc)
  if (!tr.docChanged) return set
  let next = set.map(tr.mapping, tr.doc)
  const range = touchedBlocks(tr)
  if (!range || !known.size) return next
  const doc = state.doc
  const from = Math.max(0, Math.min(range.from, doc.content.size))
  const to = Math.max(from, Math.min(range.to, doc.content.size))
  const fresh: Decoration[] = []
  let start = from
  let end = to
  doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isTextblock) return true
    start = Math.min(start, pos)
    end = Math.max(end, pos + node.nodeSize)
    fresh.push(...marksIn(node, pos))
    return false
  })
  next = next.remove(next.find(start, end))
  return next.add(doc, fresh)
}

/** Marks the words that count as correct, so the page shows no spelling underline on them. */
export const KnownWords = Extension.create({
  name: 'aiwriteKnownWords',
  addProseMirrorPlugins: () => [
    new Plugin<DecorationSet>({
      key: knownWordsKey,
      state: {
        init: (_config, state) => knownWordMarks(state.doc),
        apply
      },
      props: { decorations: (state) => knownWordsKey.getState(state) },
      view: (view) => {
        views.add(view)
        return { destroy: () => views.delete(view) }
      }
    })
  ]
})

/** For tests: the words that count as correct, as the page has them. */
export const knownWordsForTests = (words: string[]): void => {
  known = new Set(words.map((w) => w.toLocaleLowerCase()))
}
