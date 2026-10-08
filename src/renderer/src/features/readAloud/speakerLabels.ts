// "Show speakers and tone": who says each paragraph and how ("Mara · sharp, quickly", "Narrator"), shown small and
// faint just above it. A TipTap extension, in the editor's list (features/editor/extensions.ts). Owned by the Read
// aloud part.
//
// A decoration only: the label is an attribute on the paragraph's element, drawn by CSS (speakerLabels.css) in the
// space between paragraphs, so the words, the saved page, word counts, copy and paste, the page width and the
// layout never change. Each label is kept with the words it was made for, and shows only while the paragraph still
// has them: a paragraph Adam edits loses its label until it is marked again.
//
// A label that starts with a character who has a page in the world has their name drawn again over it (::before), the
// one part of a label that takes the mouse: clicking it opens their voice (onSpeakerName; the layer opens their page at
// its Read-aloud voice box), and never moves the caret.
import { Extension } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { pageParagraphs } from './pageText'

/** A paragraph's label, with the words it was made for. */
export interface ShownLabel {
  text: string
  label: string
  /** The character the label starts with, when they have a page: their name opens their voice. */
  speaker?: { entryId: string; name: string }
}

/** What clicking a speaker's name does (SpeakerLabelsLayer opens their voice). */
let onName: ((entryId: string) => void) | null = null
export function onSpeakerName(fn: ((entryId: string) => void) | null): void {
  onName = fn
}

/** The attributes that draw a paragraph's label, and its speaker's name when it starts with one. */
export function labelAttrs(l: ShownLabel): Record<string, string> {
  const attrs: Record<string, string> = { class: 'aw-speaker', 'data-speaker-label': l.label }
  if (l.speaker && l.label.startsWith(l.speaker.name)) {
    attrs['data-speaker-name'] = l.speaker.name
    attrs['data-speaker-entry'] = l.speaker.entryId
  }
  return attrs
}

/**
 * A mouse press on a speaker's name: the name is drawn just above its paragraph, so the press lands on the paragraph
 * above its top edge. Returns the speaker's entry id, else null (an ordinary press in the text).
 */
export function speakerNameAt(target: EventTarget | null, clientY: number): string | null {
  const el = target as HTMLElement | null
  if (!el || el.nodeName !== 'P' || !el.dataset?.speakerEntry) return null
  return clientY < el.getBoundingClientRect().top ? el.dataset.speakerEntry : null
}

interface State {
  labels: ReadonlyMap<string, ShownLabel>
  decorations: DecorationSet
}

export const speakerLabelsKey = new PluginKey<State>('aiwriteSpeakerLabels')

const NONE: ReadonlyMap<string, ShownLabel> = new Map()

/** The labels that fit the page as it is now. */
export function decorateLabels(doc: PMNode, labels: ReadonlyMap<string, ShownLabel>): DecorationSet {
  if (!labels.size) return DecorationSet.empty
  const out: Decoration[] = []
  for (const p of pageParagraphs(doc)) {
    const l = labels.get(p.pid)
    const node = l && l.text === p.text ? doc.nodeAt(p.pos) : null
    if (node) out.push(Decoration.node(p.pos, p.pos + node.nodeSize, labelAttrs(l!)))
  }
  return DecorationSet.create(doc, out)
}

export const speakerLabelsPlugin = new Plugin<State>({
  key: speakerLabelsKey,
  state: {
    init: () => ({ labels: NONE, decorations: DecorationSet.empty }),
    apply(tr, prev, _old, next) {
      const meta = tr.getMeta(speakerLabelsKey) as { labels: ReadonlyMap<string, ShownLabel> } | undefined
      if (meta) return { labels: meta.labels, decorations: decorateLabels(next.doc, meta.labels) }
      if (!tr.docChanged || !prev.labels.size) return prev
      return { labels: prev.labels, decorations: decorateLabels(next.doc, prev.labels) }
    }
  },
  props: {
    decorations: (state: EditorState) => speakerLabelsKey.getState(state)?.decorations ?? DecorationSet.empty,
    handleDOMEvents: {
      mousedown: (_view, event) => {
        if (event.button !== 0) return false
        const id = speakerNameAt(event.target, event.clientY)
        if (!id || !onName) return false
        event.preventDefault()
        onName(id)
        return true
      }
    }
  }
})

/** Shows these labels on the page (none: hides them all). Not an edit: nothing is saved or undone. */
export function setSpeakerLabels(
  view: { state: EditorState; dispatch: (tr: EditorState['tr']) => void },
  labels: ReadonlyMap<string, ShownLabel> | null
): void {
  const now = speakerLabelsKey.getState(view.state)
  if (!labels?.size && !now?.labels.size) return
  view.dispatch(view.state.tr.setMeta(speakerLabelsKey, { labels: labels ?? NONE }).setMeta('addToHistory', false))
}

export const SpeakerLabels = Extension.create({
  name: 'aiwriteSpeakerLabels',
  addProseMirrorPlugins: () => [speakerLabelsPlugin]
})
