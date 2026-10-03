// Focus mode's own quiet bits (milestone 6): the faint way out that shows when the mouse reaches the top edge (and
// for a moment as focus mode starts, so Adam knows how to leave), and the word count at the foot of the screen.
// The workspace renders FocusLayer once; it also installs focus mode's keys (F11, Esc). FocusButton is the top
// bar's way in.
import { Focus } from '@/components/ui/icons'
import { useEffect, useState } from 'react'
import { IconButton, Kbd } from '@/components/ui'
import { cn } from '@/lib/cn'
import { withShortcut } from '@/lib/shortcuts'
import { useApp } from '@/lib/store'
import { enterFocus, installFocusMode, leaveFocus, useFocusMode } from './focusMode'

/** How near the top edge the mouse has to come for the way out to show, and how far it goes before it fades again. */
const SHOW_WITHIN = 28
const HIDE_BEYOND = 120
/** How long the way out shows as focus mode starts. */
const HINT_MS = 2200

export function FocusLayer(): React.JSX.Element {
  const on = useFocusMode((s) => s.on)
  const words = useApp((s) => s.sceneWords)
  const [nearTop, setNearTop] = useState(false)
  const [hint, setHint] = useState(false)

  useEffect(() => installFocusMode(), [])

  useEffect(() => {
    if (!on) {
      setNearTop(false)
      setHint(false)
      return
    }
    setHint(true)
    const t = setTimeout(() => setHint(false), HINT_MS)
    const onMove = (e: MouseEvent): void => {
      if (e.clientY <= SHOW_WITHIN) setNearTop(true)
      else if (e.clientY > HIDE_BEYOND) setNearTop(false)
    }
    // The mouse leaving the window across its top edge (a screen with nothing above) counts as reaching it.
    const onOut = (e: MouseEvent): void => {
      if (!e.relatedTarget && e.clientY <= SHOW_WITHIN) setNearTop(true)
    }
    window.addEventListener('mousemove', onMove)
    document.addEventListener('mouseout', onOut)
    return () => {
      clearTimeout(t)
      window.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseout', onOut)
    }
  }, [on])

  const showWayOut = on && (nearTop || hint)
  return (
    <>
      <div
        aria-hidden={!showWayOut}
        className={cn(
          'fixed left-1/2 top-3 z-40 -translate-x-1/2 transition-[opacity,visibility] duration-200 ease-out',
          showWayOut ? 'visible opacity-100' : 'invisible opacity-0'
        )}
      >
        <button
          type="button"
          tabIndex={showWayOut ? 0 : -1}
          onMouseDown={(e) => e.preventDefault()}
          onClick={leaveFocus}
          className="flex h-8 items-center gap-2 rounded-full border border-line bg-surface px-3.5 text-[12.5px] text-muted shadow-soft transition-colors duration-150 hover:border-line-strong hover:text-fg"
        >
          Leave focus mode
          <span className="flex items-center gap-0.5" aria-hidden>
            <Kbd>F11</Kbd>
            <span className="text-faint">or</span>
            <Kbd>Esc</Kbd>
          </span>
        </button>
      </div>
      {on ? (
        <div
          aria-live="off"
          className="pointer-events-none fixed bottom-3 left-4 z-30 select-none text-[12px] tabular-nums text-faint animate-fade-in"
        >
          {words.toLocaleString()} {words === 1 ? 'word' : 'words'}
        </div>
      ) : null}
    </>
  )
}

/** The top bar's way into focus mode. It rests (but keeps its place, so the bar never moves) away from a scene's page. */
export function FocusButton(): React.JSX.Element {
  const can = useApp((s) => s.view.kind === 'write' && !!s.sceneId)
  return (
    <IconButton label="Focus mode" title={withShortcut('Focus mode', 'focusMode')} aria-keyshortcuts="F11" disabled={!can} onClick={enterFocus}>
      <Focus size={16} />
    </IconButton>
  )
}
