// Settings › Appearance: the accent colour, picked as swatches (milestone 6). A pick shows at once, everywhere,
// and is kept for next time (the window then opens in it). The swatches are a radio group: the arrow keys move
// through them and pick, as in any list of choices.
import { Check } from '@/components/ui/icons'
import { useEffect, useId, useRef, useState } from 'react'
import type { PaintedTheme } from '@shared/api'
import { accentIdOf, type AccentId } from '@shared/contracts/look'
import { cn } from '@/lib/cn'
import { useApp } from '@/lib/store'
import { ACCENTS, THEME_COLOUR_HINT, applyAccent } from './accents'

/** The theme the window shows now (the system's when set to follow it), following any change. */
export function usePaintedTheme(): PaintedTheme {
  const read = (): PaintedTheme => {
    const t = document.documentElement.dataset.theme
    return t === 'dark' || t === 'sepia' ? t : 'light'
  }
  const [theme, setTheme] = useState(read)
  useEffect(() => {
    const mo = new MutationObserver(() => setTheme(read()))
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => mo.disconnect()
  }, [])
  return theme
}

export function AccentPicker(): React.JSX.Element | null {
  const settings = useApp((s) => s.settings)
  const update = useApp((s) => s.updateSettings)
  const theme = usePaintedTheme()
  const labelId = useId()
  const hintId = useId()
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  if (!settings) return null
  const chosen = accentIdOf(settings.accent)
  const index = Math.max(0, ACCENTS.findIndex((a) => a.id === chosen))

  const pick = (id: AccentId | null): void => {
    // Painted straight away; the setting follows.
    applyAccent(id)
    if (id !== chosen) void update({ accent: id })
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (!step) return
    e.preventDefault()
    const next = (index + step + ACCENTS.length) % ACCENTS.length
    pick(ACCENTS[next].id)
    refs.current[next]?.focus()
  }

  return (
    <div className="flex flex-col gap-1">
      <span id={labelId} className="text-[12px] font-medium text-muted">
        Accent colour
      </span>
      <div role="radiogroup" aria-labelledby={labelId} aria-describedby={hintId} onKeyDown={onKeyDown} className="flex items-center gap-3 py-1.5">
        {ACCENTS.map((a, i) => {
          const c = a.colours[theme]
          const on = i === index
          return (
            <button
              key={a.id ?? 'theme'}
              ref={(el) => {
                refs.current[i] = el
              }}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={a.label}
              title={a.id ? a.label : THEME_COLOUR_HINT}
              tabIndex={on ? 0 : -1}
              onClick={() => pick(a.id)}
              style={{ backgroundColor: c.accent, color: c.fg }}
              className={cn(
                'flex h-7 w-7 items-center justify-center rounded-full transition-[box-shadow,transform] duration-150 hover:scale-110',
                on ? 'ring-2 ring-fg/60 ring-offset-2 ring-offset-bg' : 'ring-1 ring-inset ring-fg/10'
              )}
            >
              {on ? <Check size={14} strokeWidth={2.5} aria-hidden /> : null}
            </button>
          )
        })}
      </div>
      <p id={hintId} className="text-[12px] text-faint">
        For buttons, links and what’s selected. Amber, red and green stay for AI suggestions, problems and what’s done.
      </p>
    </div>
  )
}
