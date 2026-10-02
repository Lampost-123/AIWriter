// Where held-key dictation types (milestone 4): the place that has the keyboard as the key goes down (the
// scene, a scene card field, the chat, the Quick start box or any other text box), or the scene where its
// cursor was when nothing else has the keyboard. The words go in there once they are written down, at
// its cursor then, even if Adam has clicked somewhere else meanwhile. If that place has gone by then
// (another scene opened, the box closed), the words are offered to copy instead: never lost.
import type { Editor } from '@tiptap/core'
import type { ID } from '@shared/types'
import { toast } from '@/components/ui'
import { editorBridge } from '@/lib/editorBridge'
import { useApp } from '@/lib/store'
import { insertIntoEditable, insertIntoField, isTextBox } from './insertText'
import { insertIntoScene } from './insertScene'
import type { Anchor } from './place'

export type Target =
  | { kind: 'scene'; editor: Editor; sceneId: ID }
  | { kind: 'box'; el: HTMLInputElement | HTMLTextAreaElement }
  | { kind: 'editable'; el: HTMLElement }

/** Something open over the page (a dialog, a menu, a list to pick from): the page isn't where the words would go. */
const COVERED =
  '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [role="menu"], [data-radix-popper-content-wrapper]'

/** The editor showing a scene, if any. */
function sceneEditor(): { editor: Editor; sceneId: ID } | null {
  const bridge = editorBridge()
  const editor = bridge?.editor
  if (!editor || editor.isDestroyed || !bridge.sceneId) return null
  return { editor, sceneId: bridge.sceneId }
}

/** Where the words will go, as the key goes down. Null when there is nowhere to type. */
export function findTarget(): Target | null {
  const active = document.activeElement
  if (isTextBox(active)) return { kind: 'box', el: active }
  const scene = sceneEditor()
  if (scene && active && scene.editor.view.dom.contains(active)) return { kind: 'scene', ...scene }
  if (active instanceof HTMLElement && active.isContentEditable) return { kind: 'editable', el: active }
  // Nothing to type in has the keyboard (a button was just clicked, say): the page, where its cursor
  // was, while it shows with nothing over it.
  if (scene && useApp.getState().view.kind === 'write' && !document.querySelector(COVERED)) return { kind: 'scene', ...scene }
  return null
}

const SCENE_GONE = 'Another scene was opened before your words were ready, so here they are to copy:'
const PAGE_HELD = "The page can't be typed in while a new draft is getting ready, so here are your words to copy:"
const BOX_GONE = "The box your words were for can't take them now, so here they are to copy:"

/** Offers words that couldn't go where they were meant to, with a button to copy them. */
export function offerWords(text: string, why: string): void {
  const shown = text.length > 160 ? `${text.slice(0, 157).trimEnd()}…` : text
  toast(`${why} “${shown}”`, {
    action: {
      label: 'Copy',
      run: () =>
        void navigator.clipboard.writeText(text).then(
          () => toast('Copied. Paste them where you like.'),
          () => toast("Your words couldn't be copied. Try again, or say them again where you want them.", { tone: 'danger' })
        )
    }
  })
}

/** Types the words in at the target's cursor (as one Ctrl+Z step), or offers them to copy when it has gone. */
export function deliver(target: Target, text: string): void {
  if (target.kind === 'scene') {
    const now = sceneEditor()
    if (!now || now.editor !== target.editor || now.sceneId !== target.sceneId) return offerWords(text, SCENE_GONE)
    if (!target.editor.isEditable) return offerWords(text, PAGE_HELD)
    insertIntoScene(target.editor, text)
    // Nothing else has the keyboard: the page takes it, so Adam can carry on typing after the words.
    const active = document.activeElement
    if (useApp.getState().view.kind === 'write' && (!active || active === document.body)) target.editor.view.focus()
    return
  }
  const typed = target.kind === 'box' ? insertIntoField(target.el, text) : insertIntoEditable(target.el, text)
  if (!typed) offerWords(text, BOX_GONE)
}

export const rectOf = (r: DOMRect | DOMRectReadOnly): Anchor['rect'] => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom })

/** The part of the window that scrolls `el` (the page, a side panel), if any. */
function scrollArea(el: Element): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY
    if (o === 'auto' || o === 'scroll') return p
  }
  return null
}

/** Where the part of the window that `el()` is in sits now: found once, then followed as it moves. */
export function areaOf(el: () => Element | null): () => Anchor['rect'] | undefined {
  let area: HTMLElement | null = null
  return () => {
    const from = el()
    if (!from) return undefined
    if (!area?.isConnected || !area.contains(from)) area = scrollArea(from)
    return area ? rectOf(area.getBoundingClientRect()) : undefined
  }
}

/** Where the marker for words going to `target` sits, worked out as it shows; null when that place isn't on screen. */
export function anchorFor(target: Target): () => Anchor | null {
  if (target.kind === 'scene') {
    const { editor, sceneId } = target
    const within = areaOf(() => (editor.isDestroyed ? null : editor.view.dom))
    return () => {
      if (editor.isDestroyed || editorBridge()?.sceneId !== sceneId || useApp.getState().view.kind !== 'write') return null
      try {
        const { selection } = editor.state
        const c = editor.view.coordsAtPos(selection.head)
        if (c.bottom < 0 || c.top > window.innerHeight) return null
        const { $head } = selection
        const lineEnd = selection.empty && $head.parentOffset === $head.parent.content.size
        // At the end of the last paragraph, nothing comes after it at any level.
        const sceneEnd = lineEnd && $head.pos + $head.depth === editor.state.doc.content.size
        const rect = { left: c.left, top: c.top, right: c.right, bottom: c.bottom }
        return { kind: 'caret', rect, within: within(), lineEnd, sceneEnd }
      } catch {
        return null
      }
    }
  }
  const el = target.el
  const within = areaOf(() => el)
  return () => {
    if (!el.isConnected) return null
    const r = el.getBoundingClientRect()
    if (!r.width && !r.height) return null
    if (target.kind === 'editable') {
      // The line the cursor is on, when it is in there.
      const sel = window.getSelection()
      if (sel?.rangeCount && el.contains(sel.anchorNode)) {
        const c = sel.getRangeAt(0).getBoundingClientRect()
        if (c.height) return { kind: 'caret', rect: rectOf(c), within: within() }
      }
    }
    return { kind: 'box', rect: rectOf(r), within: within() }
  }
}
