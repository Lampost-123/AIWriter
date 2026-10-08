// Beat markers on the page (2026-10-08): a slim band down the left edge of each beat's paragraphs, so Adam can see
// where each beat begins and ends. A TipTap extension, in the editor's list (features/editor/extensions.ts). Owned
// by the Beat by beat part.
//
// A decoration only, like "Show speakers and tone" (features/readAloud/speakerLabels.ts): classes and data
// attributes on the paragraphs' elements, drawn by CSS (beatMarks.css), so the words, the saved page, word counts,
// copy and paste and the layout never change. What shows is set from outside (BeatMarksLayer.tsx: during a beat by
// beat session, or with "Show beats" on) and follows the page as it changes. The "Beat N" labels and their menus
// are buttons over the page (BeatMarksLayer.tsx), not part of it.
import { Extension } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { filledParagraphs } from './sessionLogic'

/** A beat as the page marks it. */
export interface MarkedBeat {
  index: number
  pids: readonly string[]
  /** Written before an earlier beat changed. */
  stale: boolean
}

export interface BeatMarksShown {
  beats: readonly MarkedBeat[]
  /** The beat the pointer is over, or whose label has the keyboard: its band is drawn stronger. */
  hot: number | null
}

interface State {
  shown: BeatMarksShown | null
  decorations: DecorationSet
}

export const beatMarksKey = new PluginKey<State>('aiwriteBeatMarks')

/** The bands for the beats shown, on the page as it is now. */
export function decorateBeats(doc: PMNode, shown: BeatMarksShown | null): DecorationSet {
  if (!shown?.beats.length) return DecorationSet.empty
  const owner = new Map<string, MarkedBeat>()
  for (const b of shown.beats) for (const pid of b.pids) if (!owner.has(pid)) owner.set(pid, b)
  const on = filledParagraphs(doc).flatMap((p) => {
    const b = owner.get(p.pid)
    return b ? [{ ...p, beat: b }] : []
  })
  const out: Decoration[] = []
  on.forEach((p, i) => {
    const first = on[i - 1]?.beat !== p.beat
    const last = on[i + 1]?.beat !== p.beat
    const cls = [
      'aw-beat',
      p.beat.index % 2 ? 'aw-beat-odd' : 'aw-beat-even',
      first && 'aw-beat-first',
      last && 'aw-beat-last',
      p.beat.stale && 'aw-beat-stale',
      shown.hot === p.beat.index && 'aw-beat-hot'
    ]
      .filter(Boolean)
      .join(' ')
    out.push(Decoration.node(p.pos, p.pos + p.node.nodeSize, { class: cls, 'data-beat': String(p.beat.index) }))
  })
  return DecorationSet.create(doc, out)
}

export const beatMarksPlugin = new Plugin<State>({
  key: beatMarksKey,
  state: {
    init: () => ({ shown: null, decorations: DecorationSet.empty }),
    apply(tr, prev, _old, next) {
      const meta = tr.getMeta(beatMarksKey) as { shown: BeatMarksShown | null } | undefined
      if (meta) return { shown: meta.shown, decorations: decorateBeats(next.doc, meta.shown) }
      if (!tr.docChanged || !prev.shown) return prev
      return { shown: prev.shown, decorations: decorateBeats(next.doc, prev.shown) }
    }
  },
  props: {
    decorations: (state: EditorState) => beatMarksKey.getState(state)?.decorations ?? DecorationSet.empty
  }
})

export const shownBeats = (state: EditorState): BeatMarksShown | null => beatMarksKey.getState(state)?.shown ?? null

/** Same beats, notes and hot beat. */
function same(a: BeatMarksShown | null, b: BeatMarksShown | null): boolean {
  if (!a || !b) return a === b
  if (a.hot !== b.hot || a.beats.length !== b.beats.length) return false
  return a.beats.every((x, i) => {
    const y = b.beats[i]
    return x.index === y.index && x.stale === y.stale && x.pids.length === y.pids.length && x.pids.every((p, j) => p === y.pids[j])
  })
}

/** Shows these beats on the page (null: none). Not an edit: nothing is saved or undone. */
export function setBeatMarks(
  view: { state: EditorState; dispatch: (tr: Transaction) => void },
  shown: BeatMarksShown | null
): void {
  if (same(shownBeats(view.state), shown)) return
  view.dispatch(view.state.tr.setMeta(beatMarksKey, { shown }).setMeta('addToHistory', false))
}

export const BeatMarks = Extension.create({
  name: 'aiwriteBeatMarks',
  addProseMirrorPlugins: () => [beatMarksPlugin]
})
