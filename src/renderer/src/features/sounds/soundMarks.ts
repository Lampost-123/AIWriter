// While the Sounds view shows, the words each sound is placed on are marked faintly in the page, and the sound a row
// is hovered over more clearly. A TipTap extension, in the editor's list (features/editor/extensions.ts).
//
// Decorations only (classes on the words, drawn by sounds.css): the words, the saved page, word counts, copy and paste
// and the layout never change. The marks follow edits until the view reads the scene's sounds again.
import { Extension } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { pageParagraphs } from '@/features/readAloud/pageText'
import { anchorRange, type SoundWords } from './soundsLogic'

interface State {
  words: readonly SoundWords[]
  hovered: string | null
  decorations: DecorationSet
}

export const soundMarksKey = new PluginKey<State>('aiwriteSoundMarks')

const NONE: readonly SoundWords[] = []

/** The marks for the page as it is now. */
export function decorateSounds(doc: PMNode, words: readonly SoundWords[], hovered: string | null): DecorationSet {
  if (!words.length) return DecorationSet.empty
  const paragraphs = pageParagraphs(doc)
  const out: Decoration[] = []
  for (const w of words) {
    const range = anchorRange(paragraphs, w.anchor)
    if (!range || range.to <= range.from) continue
    const cls = [
      'aw-sound',
      w.role === 'until' ? 'aw-sound-until' : `aw-sound-${w.kind}`,
      w.muted ? 'aw-sound-muted' : '',
      w.cueId === hovered ? 'aw-sound-hover' : ''
    ].filter(Boolean)
    out.push(Decoration.inline(range.from, range.to, { class: cls.join(' ').trim(), 'data-sound': w.cueId }))
  }
  return DecorationSet.create(doc, out)
}

export const soundMarksPlugin = new Plugin<State>({
  key: soundMarksKey,
  state: {
    init: () => ({ words: NONE, hovered: null, decorations: DecorationSet.empty }),
    apply(tr, prev, _old, next) {
      const meta = tr.getMeta(soundMarksKey) as { words?: readonly SoundWords[]; hovered?: string | null } | undefined
      if (meta) {
        const words = meta.words ?? prev.words
        const hovered = meta.hovered !== undefined ? meta.hovered : prev.hovered
        return { words, hovered, decorations: decorateSounds(next.doc, words, hovered) }
      }
      if (!tr.docChanged || !prev.words.length) return prev
      return { ...prev, decorations: prev.decorations.map(tr.mapping, tr.doc) }
    }
  },
  props: {
    decorations: (state: EditorState) => soundMarksKey.getState(state)?.decorations ?? DecorationSet.empty
  }
})

type View = { state: EditorState; dispatch: (tr: EditorState['tr']) => void }

/** Marks these sounds' words on the page (null: none). Not an edit: nothing is saved or undone. */
export function setSoundMarks(view: View, words: readonly SoundWords[] | null): void {
  const now = soundMarksKey.getState(view.state)
  if (!words?.length && !now?.words.length) return
  view.dispatch(view.state.tr.setMeta(soundMarksKey, { words: words ?? NONE, hovered: words?.length ? now?.hovered ?? null : null }).setMeta('addToHistory', false))
}

/** Marks one sound's words more clearly (a row hovered or focused in the Sounds view); null for none. */
export function setHoveredSound(view: View, cueId: string | null): void {
  const now = soundMarksKey.getState(view.state)
  if (!now || now.hovered === cueId) return
  view.dispatch(view.state.tr.setMeta(soundMarksKey, { hovered: cueId }).setMeta('addToHistory', false))
}

export const SoundMarks = Extension.create({
  name: 'aiwriteSoundMarks',
  addProseMirrorPlugins: () => [soundMarksPlugin]
})
