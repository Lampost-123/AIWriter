// The keyboard shortcuts list: press ? anywhere but in text (or choose "Keyboard shortcuts" in the
// command palette). A calm list in two groups, read from lib/shortcuts.ts, with the keys for this
// computer (⌘ on a Mac). Esc closes it and the caret goes back where it was.

import * as D from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { Fragment, useEffect } from 'react'
import { Kbd } from '@/components/ui'
import { isShortcut, isTyping, SHORTCUT_GROUPS, SHORTCUTS, shortcutKeys, shortcutText, type Shortcut } from '@/lib/shortcuts'
import { useApp } from '@/lib/store'
import { giveFocusBack, openShortcuts, PALETTE_LAYER, usePalette } from './paletteStore'

function Keys({ s }: { s: Shortcut }): React.JSX.Element {
  const keys = shortcutKeys(s.id)
  return (
    <span className="flex shrink-0 items-center gap-1 text-[12px] text-faint" aria-hidden>
      {keys.map((k, i) => (
        <Fragment key={k}>
          {i > 0 && s.either ? <span>or</span> : null}
          <Kbd>{k}</Kbd>
        </Fragment>
      ))}
    </span>
  )
}

/** ? opens the list, unless Adam is typing (then ? is just a question mark) or something else is open. */
function useOpenShortcut(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.defaultPrevented || e.repeat || !isShortcut(e, 'shortcuts') || isTyping(e.target)) return
      if (useApp.getState().restoring || usePalette.getState().shortcuts) return
      if (document.querySelector('[role="dialog"][data-state="open"], [role="menu"], [data-radix-popper-content-wrapper]')) return
      e.preventDefault()
      openShortcuts()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

export function ShortcutsList(): React.JSX.Element {
  const open = usePalette((s) => s.shortcuts)
  useOpenShortcut()

  return (
    <D.Root open={open} onOpenChange={(o) => usePalette.setState({ shortcuts: o })}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 bg-black/30 data-[state=open]:animate-fade-in" />
        <D.Content
          {...{ [PALETTE_LAYER]: '' }}
          onOpenAutoFocus={(e) => {
            // The list itself takes focus (not the close button), so Esc closes it and nothing is pressed by accident.
            e.preventDefault()
            ;(e.currentTarget as HTMLElement).focus()
          }}
          onCloseAutoFocus={(e) => {
            e.preventDefault()
            // Unless the command palette is taking over (Ctrl+K here), focus goes back where Adam was.
            if (!usePalette.getState().open) giveFocusBack()
          }}
          // Pressing a shortcut to try it while reading the list does nothing underneath (Ctrl+G doesn't start a draft).
          onKeyDown={(e) => e.stopPropagation()}
          className="fixed left-1/2 top-[12vh] z-50 max-h-[76vh] w-[560px] max-w-[calc(100vw-32px)] -translate-x-1/2 overflow-y-auto rounded-xl border border-line bg-surface p-5 shadow-pop focus:outline-none data-[state=open]:animate-pop-in"
        >
          <div className="mb-1 flex items-start justify-between gap-4">
            <div>
              <D.Title className="text-[15px] font-semibold text-fg">Keyboard shortcuts</D.Title>
              <D.Description className="mt-1 text-[13px] text-muted">
                Everything else is a few letters away in search ({shortcutText('search')}).
              </D.Description>
            </div>
            <D.Close className="rounded-md p-1 text-muted hover:bg-surface-2 hover:text-fg" aria-label="Close">
              <X size={16} />
            </D.Close>
          </div>
          {SHORTCUT_GROUPS.map((group) => (
            <section key={group} aria-label={group} className="mt-4">
              <h3 className="mb-1 text-[11.5px] font-semibold uppercase tracking-wide text-faint">{group}</h3>
              <ul>
                {SHORTCUTS.filter((s) => s.group === group).map((s) => (
                  <li key={s.id} className="flex min-h-8 items-center gap-4 border-b border-line py-1 last:border-b-0">
                    <span className="flex-1 text-[13.5px] text-fg">
                      {s.name}
                      {s.where ? <span className="text-muted"> {s.where}</span> : null}
                      <span className="sr-only">: {shortcutText(s.id)}</span>
                    </span>
                    <Keys s={s} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </D.Content>
      </D.Portal>
    </D.Root>
  )
}
