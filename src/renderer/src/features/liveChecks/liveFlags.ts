// The live checks for the Issues tab: how many flags of each kind the open scene has, and a way to go
// to the next one. A small, stable API; the tab itself is built by the AI checks part.
import { TextSelection } from '@tiptap/pm/state'
import type { LiveFlagKind } from '@shared/liveChecks'
import { editorBridge } from '@/lib/editorBridge'
import { useApp } from '@/lib/store'
import { REVEALED } from '@/features/editor/reveal'
import { liveFlagsOf } from './liveDecorations'
import { NO_FLAGS, requestLiveCard, useLiveStore, type LiveCounts } from './liveStore'

export type { LiveCounts }

/** How many phrases to avoid, common AI phrases, repetitions and misspelt names the open scene has now. */
export function useLiveFlagCounts(): LiveCounts {
  const sceneId = useApp((s) => s.sceneId)
  const counts = useLiveStore((s) => (s.sceneId && s.sceneId === sceneId ? s.counts : NO_FLAGS))
  return counts
}

/** The element that scrolls the page. */
function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const y = getComputedStyle(p).overflowY
    if (y === 'auto' || y === 'scroll') return p
  }
  return null
}

/**
 * Selects the next flag of a kind after the selection (from the top again after the last), brings it
 * into view a third of the way down the page and shows its card. Returns false when there is none (or
 * no scene is open on the writing page).
 */
export function revealLiveFlag(kind: LiveFlagKind): boolean {
  const editor = editorBridge()?.editor
  if (!editor || editor.isDestroyed || useApp.getState().view.kind !== 'write') return false
  const view = editor.view
  const flags = liveFlagsOf(view.state).filter((f) => f.kind === kind)
  if (!flags.length) return false
  const after = view.state.selection.to
  const next = flags.find((f) => f.from >= after) ?? flags[0]
  // Marked as shown, so the "Selected words" bar doesn't offer itself for it.
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, next.from, next.to)).setMeta(REVEALED, true))
  view.focus()
  const el = scrollParent(view.dom as HTMLElement)
  if (el) {
    const top = view.coordsAtPos(next.from).top - el.getBoundingClientRect().top
    el.scrollTop = Math.max(0, el.scrollTop + top - el.clientHeight / 3)
  }
  // Once the scroll has settled.
  requestAnimationFrame(() => requestLiveCard(next.from))
  return true
}
