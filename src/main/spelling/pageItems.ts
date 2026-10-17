// AI Write's own actions in the right-click menu for the page, the same as the bar over selected words: on selected
// words, Ask about this, Edit this, the AI tools (under Rewrite) and Listen from here; anywhere else in a scene's
// words, Ask about this paragraph and Listen from here. Each one goes back to the window to be carried out there.
import type { MenuItemConstructorOptions } from 'electron'
import type { PageAction, PageMenu } from '@shared/contracts/spelling'
import { EDIT_TONES } from '@shared/contracts/edits'

/** The page's items (none outside a scene's words), ending with a line before Cut, Copy and Paste. */
export function pageItems(page: PageMenu | null | undefined, pick: (action: PageAction) => void): MenuItemConstructorOptions[] {
  if (!page) return []
  const items: MenuItemConstructorOptions[] = []
  if (page.selection) {
    const tools: MenuItemConstructorOptions[] = [
      { label: 'Expand', click: () => pick({ kind: 'tool', tool: 'expand' }) },
      { label: 'Condense', click: () => pick({ kind: 'tool', tool: 'condense' }) },
      { label: 'More vivid', click: () => pick({ kind: 'tool', tool: 'vivid' }) },
      {
        label: 'Change tone',
        submenu: EDIT_TONES.map((t) => ({ label: t, click: () => pick({ kind: 'tool', tool: 'tone', direction: t }) }))
      }
    ]
    if (page.dialogue) tools.push({ label: 'Fix voice', click: () => pick({ kind: 'tool', tool: 'voice' }) })
    tools.push(
      { label: 'Alternatives', click: () => pick({ kind: 'tool', tool: 'alternatives' }) },
      { type: 'separator' },
      { label: 'Continue after these words', click: () => pick({ kind: 'tool', tool: 'continue' }) }
    )
    items.push(
      { label: 'Ask about this', click: () => pick({ kind: 'ask' }) },
      { label: 'Edit this', click: () => pick({ kind: 'edit' }) },
      { label: 'Rewrite', submenu: tools }
    )
  } else {
    items.push({ label: 'Ask about this paragraph', click: () => pick({ kind: 'ask' }) })
  }
  if (page.listen) items.push({ label: 'Listen from here', click: () => pick({ kind: 'listen' }) })
  items.push({ type: 'separator' })
  return items
}
