// The desk's scene drawer (the New look's desk layout): everything about the open scene that isn't on the page — its
// card, the briefing a draft would get (Context), who is in it, its issues and drafts, an entry shown beside the page,
// and Ask the world — in a drawer over the page's right edge. It holds today's scene panel (layout/Inspector.tsx) as it
// is, and opens and closes with the same setting (layout.inspectorOpen), so everything that opens the scene panel on a
// tab opens the drawer there. Over the page, so the page never re-wraps; it slides in 220ms and out 140ms. Esc inside
// it closes it and puts the caret back in the page.
import { useEffect, useRef } from 'react'
import type { ID } from '@shared/types'
import { X } from '@/components/ui/icons'
import { IconButton } from '@/components/ui'
import { editorBridge } from '@/lib/editorBridge'
import { useApp } from '@/lib/store'
import { AskPanel } from '@/features/ask/AskPanel'
import { closeAsk } from '@/features/ask/open'
import { useOutline } from '@/features/binder/outlineStore'
import { keyboardDriven } from '@/features/look/motion'
import { Inspector } from '@/layout/Inspector'

/** Pop-up layers (menus, lists, dialogs) and text boxes keep their own Esc. */
const OWN_ESC = '[data-radix-popper-content-wrapper], [role="dialog"], [role="menu"], [role="listbox"], input, textarea, select, [contenteditable="true"]'

/** The drawer's width: Adam's scene panel width, kept between 300 and 360px (it lies over the page). */
const widthOf = (w: number): number => Math.max(300, Math.min(360, w))

export function SceneDrawer({ open, sceneId }: { open: boolean; sceneId: ID | null }): React.JSX.Element | null {
  const askOpen = useApp((s) => s.askOpen)
  const width = useApp((s) => s.settings?.layout.inspectorWidth ?? 340)
  const update = useApp((s) => s.updateSettings)
  const { outline } = useOutline()
  const ref = useRef<HTMLElement>(null)
  const instant = useRef(false)
  const title = sceneId ? (outline?.scenes.find((s) => s.id === sceneId)?.title ?? '') : ''
  const has = !!sceneId || askOpen

  // Opened or closed from the keyboard: at once.
  const was = useRef(open)
  if (was.current !== open) {
    was.current = open
    instant.current = keyboardDriven()
  }

  const close = (): void => {
    const inside = !!ref.current?.contains(document.activeElement)
    if (askOpen && !sceneId) closeAsk()
    else void update({ layout: { inspectorOpen: false } })
    if (inside) editorBridge()?.editor?.view.focus()
  }
  const closeRef = useRef(close)
  closeRef.current = close

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      const target = e.target instanceof Element ? e.target : null
      if (!target || !ref.current?.contains(target) || target.closest(OWN_ESC)) return
      e.preventDefault()
      closeRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  if (!has) return null
  return (
    <aside
      ref={ref}
      aria-label={sceneId ? 'Scene panel' : 'Ask the world'}
      inert={!open}
      data-state={open ? 'open' : 'closed'}
      data-instant={instant.current || undefined}
      // It stops above the page's tools, so Generate and the rest stay in reach.
      className="desk-drawer absolute bottom-[84px] right-3 top-3 z-30 flex flex-col overflow-hidden rounded-[16px]"
      style={{ width: widthOf(width) }}
    >
      {sceneId && !askOpen ? (
        <div className="flex h-11 shrink-0 items-center gap-2 pl-4 pr-2">
          <span className="desk-caps shrink-0">Scene</span>
          <span className="min-w-0 flex-1 truncate font-heading text-[14.5px] font-semibold text-fg">{title || 'Untitled scene'}</span>
          <IconButton label="Close the scene panel" size="sm" onClick={close}>
            <X size={14} />
          </IconButton>
        </div>
      ) : null}
      <div className="min-h-0 flex-1">{sceneId ? <Inspector sceneId={sceneId} /> : <AskPanel sceneId={null} onClose={closeAsk} />}</div>
    </aside>
  )
}
