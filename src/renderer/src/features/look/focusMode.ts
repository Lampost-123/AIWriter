// Focus mode (milestone 6, spec "Main window"): F11 on the writing page fills the screen with the page alone.
// The binder, the scene panel, the top bar and the scene's toolbar fade away (styles.css, data-focus-chrome);
// the page stays where it is, at Adam's page width, centred, with the line he is on held still on screen while
// the panels slide away. Esc or F11 leaves, putting the panels back exactly as they were (their saved widths
// and open states). A faint way out shows when the mouse reaches the top edge (FocusLayer).
//
// Everything else keeps working inside it: drafts stream, reading aloud and dictation carry on, the AI's
// changes show in the page. Ask the world and a name shown beside the page open the scene panel over the
// page's right edge (App.tsx), and the command palette (Ctrl+K) reaches everything. Leaving the writing page
// (Settings, another page) ends focus mode.

import { create } from 'zustand'
import { toast } from '@/components/ui'
import { api, onEvent } from '@/lib/api'
import { editorBridge } from '@/lib/editorBridge'
import { escapeTaken } from '@/lib/escape'
import { isShortcut } from '@/lib/shortcuts'
import { useApp } from '@/lib/store'
import { useBeats } from '@/features/beats/session'
import { activeSuggestion } from '@/features/edits/suggestions'
import { canFocus, escLeaves, layoutToRestore, mustLeave, panelsOf, type PanelLayout, type Place } from './focusLogic'

interface FocusState {
  on: boolean
  /** Focus mode has just started or ended: the panels ease to their new widths even while the window resizes. */
  moving: boolean
  /** The panels as they were before focus mode. */
  before: PanelLayout | null
}

export const useFocusMode = create<FocusState>(() => ({ on: false, moving: false, before: null }))

/** How long the panels take to slide, and the window to fill the screen, before things settle. */
const SETTLE_MS = 450

const place = (): Place => {
  const a = useApp.getState()
  return { view: a.view.kind, sceneId: a.sceneId, hasWorld: !!a.world }
}

let settleTimer: ReturnType<typeof setTimeout> | undefined
function settleSoon(): void {
  clearTimeout(settleTimer)
  settleTimer = setTimeout(() => useFocusMode.setState({ moving: false }), SETTLE_MS)
}

let keepToken = 0
/**
 * Holds the line Adam is on (the caret's line, or the line a third of the way down the page when the caret is
 * out of sight) at the same height on screen while the panels slide and the window changes size, so the page
 * never jumps; the scroll position follows the text. Not while a draft is being written (the page follows the
 * draft then).
 */
function keepPlace(ms = SETTLE_MS + 250): void {
  const token = ++keepToken
  const ed = editorBridge()?.editor
  if (!ed || ed.isDestroyed || editorBridge()?.busy()) return
  const view = ed.view
  const scroller = view.dom.closest<HTMLElement>('.overflow-y-auto')
  if (!scroller) return
  const topOf = (pos: number): number | null => {
    try {
      return view.coordsAtPos(Math.min(pos, view.state.doc.content.size)).top
    } catch {
      return null
    }
  }
  const box = scroller.getBoundingClientRect()
  let pos = view.state.selection.head
  let y = topOf(pos)
  if (y === null || y < box.top || y > box.bottom) {
    const prose = view.dom.getBoundingClientRect()
    const hit = view.posAtCoords({ left: prose.left + Math.min(40, prose.width / 2), top: box.top + box.height / 3 })
    if (!hit) return
    pos = hit.pos
    y = topOf(pos)
    if (y === null) return
  }
  const anchor = y
  const start = performance.now()
  const step = (): void => {
    if (token !== keepToken || ed.isDestroyed) return
    const now = topOf(pos)
    if (now !== null && Math.abs(now - anchor) >= 1) scroller.scrollTop += now - anchor
    if (performance.now() - start < ms) requestAnimationFrame(step)
  }
  requestAnimationFrame(step)
}

/** The keyboard was on something that is going away (a button in the top bar or the binder): it goes into the page. */
function keyboardToPage(): void {
  const el = document.activeElement
  if (!(el instanceof HTMLElement) || el === document.body) return
  if (el.closest('[data-focus-chrome], aside')) editorBridge()?.editor?.view.focus()
}

/** Starts focus mode on the writing page (going back to it from another page), if a scene is open. */
export function enterFocus(): void {
  if (useFocusMode.getState().on) return
  const a = useApp.getState()
  if (!canFocus(place()) || !a.settings) {
    if (a.world) toast('Focus mode is for writing: open a scene first, then press F11.')
    return
  }
  if (a.view.kind !== 'write') a.navigate({ kind: 'write' })
  keepPlace()
  useFocusMode.setState({ on: true, moving: true, before: panelsOf(a.settings.layout) })
  document.documentElement.dataset.focus = ''
  keyboardToPage()
  settleSoon()
  void api.setFullScreen(true).catch(() => undefined)
}

/** Ends focus mode: the window and the panels go back to exactly how they were. */
export function leaveFocus(): void {
  const { on, before } = useFocusMode.getState()
  if (!on) return
  if (place().view === 'write') keepPlace()
  useFocusMode.setState({ on: false, moving: true, before: null })
  delete document.documentElement.dataset.focus
  settleSoon()
  void api.setFullScreen(false).catch(() => undefined)
  const a = useApp.getState()
  // Ask the world or a name opened over the page's edge, with the scene panel shut before: they close with focus mode.
  if (before && !before.inspectorOpen) {
    if (a.peekEntryId) a.peekEntry(null)
    if (a.askOpen) a.setAskOpen(false)
  }
  const patch = layoutToRestore(before, useApp.getState().settings?.layout)
  if (patch) void a.updateSettings({ layout: patch }).catch(() => undefined)
}

export function toggleFocus(): void {
  if (useFocusMode.getState().on) leaveFocus()
  else enterFocus()
}

/**
 * True while a draft or a beat is being written into the page (or getting ready to be), or the AI's change to some
 * words waits for Tab or Esc: Esc stops or rejects it first.
 */
function drafting(): boolean {
  const phase = useBeats.getState().session?.phase
  const ed = editorBridge()?.editor
  const change = !!ed && !ed.isDestroyed && activeSuggestion(ed.state) !== null
  return (
    change || useApp.getState().activeGeneration !== null || !!editorBridge()?.busy() || phase === 'starting' || phase === 'writing' || phase === 'stopping'
  )
}

const LAYERS = '[data-radix-popper-content-wrapper], [role="dialog"][data-state="open"], [data-hover-card]'

const inPage = (t: EventTarget | null): boolean => t instanceof Element && !!t.closest('.ProseMirror')

function inPageOrNowhere(t: EventTarget | null): boolean {
  return !(t instanceof Element) || t === document.body || t === document.documentElement || inPage(t)
}

/** Whether something was being written (or an AI change waited) as an Esc went down, before anything acted on it. */
const draftingAtPress = new WeakMap<Event, boolean>()

/**
 * F11 and Esc, the app's state and the window: focus mode starts and ends with them. Installed once by the
 * workspace (FocusLayer); ends focus mode when the workspace goes.
 */
export function installFocusMode(): () => void {
  const onKeyFirst = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && useFocusMode.getState().on) draftingAtPress.set(e, drafting())
  }
  const onKey = (e: KeyboardEvent): void => {
    if (isShortcut(e, 'focusMode')) {
      if (e.defaultPrevented || e.repeat) return
      e.preventDefault()
      toggleFocus()
      return
    }
    if (e.key !== 'Escape' || !useFocusMode.getState().on) return
    const leaves = escLeaves({
      // The page marks every Esc handled (as Generate's Esc knows); what it did with one shows in `drafting`.
      handled: escapeTaken(e) || (e.defaultPrevented && !inPage(e.target)),
      composing: e.isComposing,
      inPageOrNowhere: inPageOrNowhere(e.target),
      layerOpen: !!document.querySelector(LAYERS),
      drafting: draftingAtPress.get(e) ?? drafting()
    })
    if (!leaves) return
    e.preventDefault()
    leaveFocus()
  }
  window.addEventListener('keydown', onKeyFirst, true)
  window.addEventListener('keydown', onKey)
  const offApp = useApp.subscribe(() => {
    if (useFocusMode.getState().on && mustLeave(place())) leaveFocus()
  })
  // The window stopped filling the screen some other way: focus mode ends with it.
  const offFull = onEvent('look:fullScreen', ({ on }) => {
    if (!on && useFocusMode.getState().on && !useFocusMode.getState().moving) leaveFocus()
  })
  return () => {
    window.removeEventListener('keydown', onKeyFirst, true)
    window.removeEventListener('keydown', onKey)
    offApp()
    offFull()
    leaveFocus()
  }
}
