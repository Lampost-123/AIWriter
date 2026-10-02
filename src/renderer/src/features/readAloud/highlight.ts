// The soft highlight on the sentence being read, in the page. A TipTap extension, in the editor's list
// (features/editor/extensions.ts). Owned by the Read aloud part.
//
// It is a decoration only: the words and their marks never change, nothing is saved and nothing goes in the
// undo history. It also keeps where the clip being read starts and ends, mapped through every edit, so reading
// carries on from the right place after Adam edits while it reads (control.ts). Its look is in readAloud.css.
// While the reading bar lies over the top of the page, the cursor is kept clear of it when the page scrolls to it.
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

export interface ReadingPlace {
  /** The sentence being read, highlighted. */
  sentence: { from: number; to: number } | null
  /** The clip being read: where it starts (to start it again) and ends (where the next one starts). */
  clip: { from: number; to: number } | null
}

interface State extends ReadingPlace {
  decorations: DecorationSet
}

export const readingKey = new PluginKey<State>('aiwriteReadAloud')

const EMPTY: State = { sentence: null, clip: null, decorations: DecorationSet.empty }

function decorate(state: Pick<State, 'sentence'>, doc: EditorState['doc']): DecorationSet {
  const s = state.sentence
  if (!s || s.to <= s.from) return DecorationSet.empty
  return DecorationSet.create(doc, [Decoration.inline(s.from, s.to, { class: 'aw-reading' })])
}

/** A range mapped through an edit: text typed at either edge stays outside it. Null once it has no length left. */
function mapped(range: { from: number; to: number } | null, tr: Transaction): { from: number; to: number } | null {
  if (!range) return null
  const from = tr.mapping.map(range.from, 1)
  const to = tr.mapping.map(range.to, -1)
  return to > from ? { from, to } : { from: Math.min(from, to), to: Math.min(from, to) }
}

/**
 * The room the reading bar takes at the top of the page (ReadAloudBar sets it). ProseMirror reads these when it
 * scrolls the cursor into view: the plugin keeps the objects themselves, so they change in place.
 */
const barThreshold = { top: 0, right: 0, bottom: 0, left: 0 }
const barMargin = { top: 5, right: 5, bottom: 5, left: 5 }

/** The reading bar's height over the page, in pixels (0 when it is closed). */
export function setBarRoom(px: number): void {
  barThreshold.top = Math.max(0, Math.round(px))
  barMargin.top = barThreshold.top + 5
}

/** The room the reading bar takes at the top of the page now. */
export const barRoom = (): number => barThreshold.top

export const readingPlugin = new Plugin<State>({
  key: readingKey,
  state: {
    init: () => EMPTY,
    apply(tr, prev, _old, next) {
      const meta = tr.getMeta(readingKey) as Partial<ReadingPlace> | undefined
      if (!meta && !tr.docChanged) return prev
      const sentence = meta && 'sentence' in meta ? (meta.sentence ?? null) : mapped(prev.sentence, tr)
      const clip = meta && 'clip' in meta ? (meta.clip ?? null) : mapped(prev.clip, tr)
      if (!meta) {
        // Only the edit: the highlight moves with the words (a sentence typed over loses it).
        const decorations = sentence && sentence.to > sentence.from ? prev.decorations.map(tr.mapping, tr.doc) : DecorationSet.empty
        return { sentence, clip, decorations }
      }
      const size = next.doc.content.size
      const inDoc = (r: { from: number; to: number } | null): { from: number; to: number } | null =>
        r && r.from >= 0 && r.to <= size && r.to >= r.from ? r : null
      const place = { sentence: inDoc(sentence), clip: inDoc(clip) }
      return { ...place, decorations: decorate(place, next.doc) }
    }
  },
  props: {
    decorations: (state) => readingKey.getState(state)?.decorations ?? DecorationSet.empty,
    scrollThreshold: barThreshold,
    scrollMargin: barMargin
  }
})

/** Where reading is on the page now, mapped through any edits since it was set. */
export const readingPlace = (state: EditorState): ReadingPlace => {
  const s = readingKey.getState(state) ?? EMPTY
  return { sentence: s.sentence, clip: s.clip }
}

/** A transaction that sets (or, with nulls, clears) where reading is. Not an edit: nothing is saved or undone. */
export const setReadingPlace = (tr: Transaction, place: Partial<ReadingPlace>): Transaction =>
  tr.setMeta(readingKey, place).setMeta('addToHistory', false)

export const ReadAloudHighlight = Extension.create({
  name: 'aiwriteReadAloud',
  addProseMirrorPlugins: () => [readingPlugin]
})
