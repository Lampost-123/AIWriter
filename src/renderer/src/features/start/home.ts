// Ways back to the start screen: the top bar's Home button, the world menu and the command palette.

import { useApp } from '@/lib/store'
import { leaveFocus, useFocusMode } from '@/features/look/focusMode'

/** What had the keyboard before the start screen showed, to give it back when Continue closes it. */
let before: HTMLElement | null = null

/** Shows the start screen over the workspace (focus mode ends first). A draft being written carries on underneath. */
export function goToStartScreen(): void {
  const active = document.activeElement
  before = active instanceof HTMLElement && active !== document.body ? active : null
  if (useFocusMode.getState().on) leaveFocus()
  useApp.getState().goHome()
}

/** Gives the keyboard back to what had it before the start screen showed, if it is still there and can take it. */
export function focusBeforeHome(): void {
  const el = before
  before = null
  if (!el || !el.isConnected || el.closest('[inert]')) return
  const active = document.activeElement
  if (active && active !== document.body) return
  el.focus({ preventScroll: true })
}
