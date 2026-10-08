// The desk's scene drawer (the New look's desk layout): everything about the open scene that isn't on the page — its
// card, the briefing a draft would get (Context), who is in it, its issues and drafts, an entry shown beside the page,
// and Ask the world. It holds today's scene panel (layout/Inspector.tsx) as it is, and opens and closes with the same
// setting (layout.inspectorOpen), so everything that opens the scene panel on a tab opens the drawer there; the top
// bar's Scene details button shows and hides it.
// A full-height panel down the right edge with the spine's insets, so the two read as a pair: its head on the spine's
// leather, its tabs and their pages on paper. While the spine, the sheet and the drawer all fit, it lies beside the
// page (the sheet glides to the middle of the room between them); in a smaller window it lies over the page's edge,
// stopping above the page's tools. Each tab's page scrolls inside it, with room after its last field and a soft fade
// at an edge only while there is more that way. It slides in 220ms and out 140ms; Esc inside it closes it and puts the
// caret back in the page.
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
import { DRAWER, useDeskFrame } from './deskFit'

/** Pop-up layers (menus, lists, dialogs) and text boxes keep their own Esc. */
const OWN_ESC = '[data-radix-popper-content-wrapper], [role="dialog"], [role="menu"], [role="listbox"], input, textarea, select, [contenteditable="true"]'

/** What scrolls inside the drawer: each tab's page. */
const SCROLLS = '[role="tabpanel"]'

/** Marks each tab's page with whether there is more above or below what shows (desk.css fades that edge). */
function markEdges(root: HTMLElement): void {
  for (const el of root.querySelectorAll<HTMLElement>(SCROLLS)) {
    el.toggleAttribute('data-more-above', el.scrollTop > 1)
    el.toggleAttribute('data-more-below', el.scrollHeight - el.scrollTop - el.clientHeight > 1)
  }
}

export function SceneDrawer({ open, sceneId }: { open: boolean; sceneId: ID | null }): React.JSX.Element | null {
  const askOpen = useApp((s) => s.askOpen)
  const update = useApp((s) => s.updateSettings)
  const { outline } = useOutline()
  const frame = useDeskFrame()
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

  // Closing, it keeps the shape it had open (it slides away as it was).
  const docked = useRef(frame.drawerDocked)
  if (open) docked.current = frame.drawerDocked

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

  // The fades at a tab page's edges follow its scrolling, its size and the tab showing.
  useEffect(() => {
    const root = ref.current
    if (!open || !root) return
    let frameId = 0
    const later = (): void => {
      if (frameId) return
      frameId = requestAnimationFrame(() => {
        frameId = 0
        markEdges(root)
      })
    }
    markEdges(root)
    root.addEventListener('scroll', later, { capture: true, passive: true })
    const ro = new ResizeObserver(later)
    ro.observe(root)
    const mo = new MutationObserver(later)
    mo.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-state', 'hidden'] })
    return () => {
      root.removeEventListener('scroll', later, { capture: true })
      ro.disconnect()
      mo.disconnect()
      if (frameId) cancelAnimationFrame(frameId)
    }
  }, [open, sceneId, askOpen])

  if (!has) return null
  return (
    <aside
      ref={ref}
      aria-label={sceneId ? 'Scene panel' : 'Ask the world'}
      inert={!open}
      data-state={open ? 'open' : 'closed'}
      data-docked={docked.current || undefined}
      data-instant={instant.current || undefined}
      className="desk-drawer absolute z-30 flex flex-col overflow-hidden"
      // Docked, it runs the window's height as the spine does; over the page, it stops above the page's tools.
      style={{ top: DRAWER.top, right: DRAWER.right, bottom: docked.current ? DRAWER.bottom : 92, width: frame.drawerW }}
    >
      {sceneId && !askOpen ? (
        <div className="desk-drawer-head desk-leather flex h-[52px] shrink-0 items-center gap-2.5 pl-5 pr-2.5">
          <span className="desk-caps shrink-0">Scene</span>
          <span className="min-w-0 flex-1 truncate font-heading text-[16px] font-semibold text-fg">{title || 'Untitled scene'}</span>
          <IconButton label="Close the scene panel" onClick={close}>
            <X size={15} />
          </IconButton>
        </div>
      ) : null}
      <div className="desk-drawer-body min-h-0 flex-1">{sceneId ? <Inspector sceneId={sceneId} /> : <AskPanel sceneId={null} onClose={closeAsk} />}</div>
    </aside>
  )
}
