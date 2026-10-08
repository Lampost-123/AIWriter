// The desk's story flyout: the whole story beside the spine, on a sheet of paper over the page. It holds the real
// binder (features/binder/Binder.tsx), so every chapter and scene can be opened, renamed, moved, folded and deleted as in
// the binder, with its keys and Undo. Its head says how much the story holds; its foot adds a scene or pins it open.
// Pinned (the saved layout's binderOpen), it stays beside the page while there is room for both (layout/desk/deskFit.ts);
// otherwise it slides out over the page (220ms) and back (140ms), closing on Esc, a click elsewhere, or picking a scene.
import { useEffect, useLayoutEffect, useRef } from 'react'
import { Pin, Plus } from '@/components/ui/icons'
import { Button, IconButton } from '@/components/ui'
import { cn } from '@/lib/cn'
import { takeEscape } from '@/lib/escape'
import { useApp } from '@/lib/store'
import { Binder } from '@/features/binder/Binder'
import { useOutline } from '@/features/binder/outlineStore'
import { newSceneAfterOpen } from '@/features/palette/actions'
import { useDeskFrame } from '@/layout/desk/deskFit'
import { setFlyout, useDeskStore } from '../deskStore'

/** Pop-up layers (menus, lists, dialogs) a click or Esc inside belongs to, not to the page behind. */
const LAYERS = '[data-radix-popper-content-wrapper], [role="dialog"], [role="menu"], [role="listbox"]'

const isTextBox = (el: Element | null): boolean => !!el && (el.matches('input, textarea, select') || el.closest('[role="combobox"]') !== null)

const wordsLabel = (n: number): string => `${n.toLocaleString('en-GB')} ${n === 1 ? 'word' : 'words'}`

/** How tall the flyout needs to be for the story (it never grows past the room under the top bar). */
function heightFor(chapters: number, scenes: number): number {
  return 64 + 14 + chapters * 36 + scenes * 32 + 44 + 58
}

export function Flyout(): React.JSX.Element {
  const open = useDeskStore((s) => s.flyoutOpen)
  const instant = useDeskStore((s) => s.instant)
  const { pinned, pinRoom } = useDeskFrame()
  const update = useApp((s) => s.updateSettings)
  const story = useApp((s) => s.stories.find((x) => x.id === s.storyId) ?? null)
  const sceneId = useApp((s) => s.sceneId)
  const liveWords = useApp((s) => s.sceneWords)
  const { outline } = useOutline()
  const ref = useRef<HTMLElement>(null)
  const shows = pinned || open

  const scenes = outline?.scenes ?? []
  const words = scenes.reduce((n, s) => n + (s.id === sceneId ? liveWords : s.wordCount), 0)
  const sub = outline ? `${scenes.length.toLocaleString('en-GB')} ${scenes.length === 1 ? 'scene' : 'scenes'} · ${wordsLabel(words)}` : ''

  // Gone with the writing page: it starts shut next time.
  useEffect(() => () => setFlyout(false), [])

  // Picking a scene or another page is what it was opened for (pinned, it stays).
  useEffect(() => {
    if (pinned || !open) return
    return useApp.subscribe((s, prev) => {
      if (s.sceneId !== prev.sceneId || s.view !== prev.view || s.storyId !== prev.storyId) setFlyout(false)
    })
  }, [pinned, open])

  // Opened over the page: the keyboard goes onto the open scene's row, so the arrows and Enter work at once; Esc or a
  // click elsewhere closes it, and the keyboard goes back to the spine.
  const floating = open && !pinned
  useLayoutEffect(() => {
    if (!floating) return
    const el = ref.current
    if (el && !el.contains(document.activeElement)) {
      const row = el.querySelector<HTMLElement>('[role="treeitem"][tabindex="0"]')
      ;(row ?? el).focus({ preventScroll: true })
      row?.scrollIntoView({ block: 'nearest' })
    }
    const spine = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-desk-spine] .spine-hit')
    const close = (): void => {
      const inside = !!el?.contains(document.activeElement)
      setFlyout(false)
      if (inside) spine()?.focus({ preventScroll: true })
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      const target = e.target instanceof Element ? e.target : null
      // Esc in a menu or a text box (renaming a scene) belongs to that first.
      if (target && (target.closest(LAYERS) || (el?.contains(target) && isTextBox(target)))) return
      e.preventDefault()
      // Closing it is all this Esc does (a draft being written carries on).
      takeEscape(e)
      close()
    }
    const onDown = (e: PointerEvent): void => {
      const target = e.target instanceof Element ? e.target : null
      if (!target || el?.contains(target) || target.closest(LAYERS) || target.closest('[data-desk-spine]')) return
      setFlyout(false)
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('pointerdown', onDown, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('pointerdown', onDown, true)
    }
  }, [floating])

  const togglePin = (): void => {
    const next = !pinned
    // Unpinned, it stays open over the page for now (it was open); pinned, it simply stays.
    if (!next) setFlyout(true)
    void update({ layout: { binderOpen: next } })
  }

  return (
    <aside
      ref={ref}
      aria-label="Story contents"
      tabIndex={-1}
      inert={!shows}
      data-state={shows ? 'open' : 'closed'}
      data-pinned={pinned || undefined}
      data-instant={instant || undefined}
      data-focus-chrome
      className="desk-flyout absolute left-[76px] top-5 z-30 flex w-[288px] flex-col rounded-[16px] px-2.5 pb-2.5 pt-3.5 outline-none"
      style={{ height: `min(calc(100% - 44px), ${heightFor(outline?.chapters.length ?? 1, scenes.length)}px)` }}
    >
      <div className="shrink-0 px-3 pt-0.5">
        <h2 className="truncate font-heading text-[17px] font-semibold leading-[22px] tracking-[-0.01em] text-fg">{story?.title ?? 'No story yet'}</h2>
        {sub ? <p className="mt-0.5 truncate text-[12px] leading-4 tabular-nums text-muted">{sub}</p> : null}
      </div>
      <div className="desk-binder mt-2.5 min-h-0 flex-1">
        <Binder world={false} switcher={false} />
      </div>
      <div className="flex shrink-0 items-center gap-1.5 border-t border-line pt-2.5">
        <Button className="h-[34px] flex-1" icon={<Plus size={15} />} disabled={!story} onClick={() => void newSceneAfterOpen()}>
          New scene
        </Button>
        <IconButton
          label={pinned ? 'Unpin: open it from the spine when you need it' : pinRoom ? 'Pin open beside the page' : 'No room to pin it open in a window this size'}
          aria-pressed={pinned}
          active={pinned}
          disabled={!pinRoom && !pinned}
          onClick={togglePin}
          className={cn('h-[34px] w-[34px]')}
        >
          <Pin size={16} selected={pinned} />
        </IconButton>
      </div>
    </aside>
  )
}
