// Ways back to the start screen: the top bar's Home button, the world menu and the command palette.

import { useApp } from '@/lib/store'
import { leaveFocus, useFocusMode } from '@/features/look/focusMode'

/** Shows the start screen over the workspace (focus mode ends first). A draft being written carries on underneath. */
export function goToStartScreen(): void {
  if (useFocusMode.getState().on) leaveFocus()
  useApp.getState().goHome()
}
