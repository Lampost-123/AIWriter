// Settings › Appearance › Style: the New look or Classic, picked from two small pictures of the window. A pick shows
// at once and is kept for next time (the window then opens in it). Like the accent swatches, the two are a radio
// group: the arrow keys move between them and pick.
import { useId, useRef } from 'react'
import type { PaintedTheme } from '@shared/api'
import { lookOf, type Look } from '@shared/contracts/look'
import { cn } from '@/lib/cn'
import { useApp } from '@/lib/store'
import { usePaintedTheme } from './AccentPicker'
import { applyLook } from './look'

const CHOICES: { look: Look; label: string; hint: string }[] = [
  { look: 'new', label: 'New look', hint: 'Warm paper, a colour for each kind of thing, and four areas down the side' },
  { look: 'classic', label: 'Classic', hint: 'How AI Write looked before, with everything in one list' }
]

/** Picks a look: painted at once, then saved (and the one-time note about the New look is done with). */
export function chooseLook(look: Look): void {
  const app = useApp.getState()
  applyLook(look)
  if (app.settings) useApp.setState({ settings: { ...app.settings, look, lookNote: false } })
  void app.updateSettings({ look, lookNote: false })
}

export function LookPicker(): React.JSX.Element | null {
  const look = useApp((s) => (s.settings ? lookOf(s.settings.look) : null))
  const theme = usePaintedTheme()
  const labelId = useId()
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  if (!look) return null
  const index = CHOICES.findIndex((c) => c.look === look)

  const onKeyDown = (e: React.KeyboardEvent): void => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (!step) return
    e.preventDefault()
    const next = (index + step + CHOICES.length) % CHOICES.length
    chooseLook(CHOICES[next].look)
    refs.current[next]?.focus()
  }

  return (
    <div className="flex flex-col gap-1">
      <span id={labelId} className="text-[12px] font-medium text-muted">
        Style
      </span>
      <div role="radiogroup" aria-labelledby={labelId} onKeyDown={onKeyDown} className="grid grid-cols-2 gap-3 py-1.5">
        {CHOICES.map((c, i) => {
          const on = c.look === look
          return (
            <button
              key={c.look}
              ref={(el) => {
                refs.current[i] = el
              }}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={c.label}
              tabIndex={on ? 0 : -1}
              onClick={() => chooseLook(c.look)}
              className={cn(
                'group flex flex-col overflow-hidden rounded-card bg-page text-left transition-[box-shadow,transform] duration-(--dur-quick) ease-glide',
                'shadow-e1 hover:-translate-y-0.5 hover:shadow-e2 active:scale-[0.98]',
                on ? 'ring-2 ring-accent' : 'ring-1 ring-line'
              )}
            >
              <span aria-hidden className="relative block h-[104px] overflow-hidden">
                {c.look === 'new' ? <NewThumb theme={theme} /> : <ClassicThumb theme={theme} />}
              </span>
              <span className="flex items-start gap-2 px-3 py-2.5">
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-medium text-fg">{c.label}</span>
                  <span className="mt-0.5 block text-[11.5px] leading-snug text-faint">{c.hint}</span>
                </span>
                <span
                  className={cn(
                    'mt-0.5 h-4 w-4 shrink-0 rounded-full transition-shadow duration-(--dur-quick)',
                    on ? 'shadow-[inset_0_0_0_5px_var(--accent)]' : 'shadow-[inset_0_0_0_2px_var(--line-strong)]'
                  )}
                />
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** The colours each picture is drawn in, per theme (the looks' own --bg, --surface, --page ...; styles.css). */
const NEW: Record<PaintedTheme, { frame: string; pane: string; page: string; raise: string; line: string; ink: string; kinds: string[] }> = {
  light: { frame: '#ebe5da', pane: '#f4efe7', page: '#fffdf9', raise: '#ffffff', line: '#cdc3b3', ink: '#221d17', kinds: ['#efe7f8', '#ddf0ee', '#e6e7f6'] },
  dark: { frame: '#12110f', pane: '#1a1816', page: '#221f1c', raise: '#2b2825', line: '#433d37', ink: '#eee8de', kinds: ['#2f2440', '#17302e', '#262848'] },
  sepia: { frame: '#e5d9c0', pane: '#efe6d1', page: '#faf4e5', raise: '#fffaf0', line: '#c4b18c', ink: '#3b2f22', kinds: ['#eadff0', '#d8e8df', '#e1def0'] }
}
const CLASSIC: Record<PaintedTheme, { bg: string; surface: string; page: string; line: string; strong: string; accent: string }> = {
  light: { bg: '#f6f4f0', surface: '#fbfaf8', page: '#ffffff', line: '#e2ddd4', strong: '#cfc8bc', accent: '#e3eaf3' },
  dark: { bg: '#161514', surface: '#1d1c1a', page: '#1f1e1c', line: '#34312d', strong: '#46423d', accent: '#263548' },
  sepia: { bg: '#ece3cf', surface: '#f4ecd8', page: '#f8f1e0', line: '#dccfb2', strong: '#c9b996', accent: '#ecd9c4' }
}

function NewThumb({ theme }: { theme: PaintedTheme }): React.JSX.Element {
  const c = NEW[theme]
  const bar = (w: string, bg: string, extra?: React.CSSProperties): React.JSX.Element => (
    <i className="block h-[7px] rounded-[3px]" style={{ width: w, background: bg, ...extra }} />
  )
  return (
    <span className="absolute inset-0" style={{ background: c.frame }}>
      {/* The rail and the area's list. */}
      <span className="absolute bottom-0 left-[5px] top-[12px] grid w-[12px] content-start gap-[5px]">
        {bar('12px', c.raise, { height: 12, boxShadow: '0 1px 2px rgb(0 0 0 / 0.12)' })}
        {bar('12px', c.line, { height: 12, opacity: 0.5 })}
        {bar('12px', c.line, { height: 12, opacity: 0.5 })}
      </span>
      <span className="absolute left-[23px] top-[12px] grid w-[24%] gap-[5px]">
        {bar('80%', c.line, { opacity: 0.6 })}
        {bar('100%', c.raise, { boxShadow: '0 1px 2px rgb(0 0 0 / 0.12)' })}
        {bar('100%', c.kinds[0])}
        {bar('100%', c.kinds[1])}
        {bar('100%', c.kinds[2])}
      </span>
      {/* The page: a sheet of paper on the frame. */}
      <span
        className="absolute bottom-0 left-[40%] right-[20%] top-[12px] rounded-t-[7px] px-3 pt-3"
        style={{ background: c.page, boxShadow: '0 4px 14px rgb(60 40 15 / 0.16), 0 0 0 1px rgb(60 40 15 / 0.05)' }}
      >
        {bar('45%', c.ink, { height: 8, opacity: 0.75 })}
        <span className="mt-2 grid gap-[6px]">
          {bar('100%', c.line, { height: 4 })}
          {bar('92%', c.line, { height: 4 })}
          {bar('96%', c.line, { height: 4 })}
          {bar('70%', c.line, { height: 4 })}
        </span>
      </span>
      <span className="absolute right-[5px] top-[12px] grid w-[14%] gap-[5px]">
        {bar('100%', c.pane, { height: 20 })}
        {bar('100%', c.pane, { height: 30 })}
      </span>
    </span>
  )
}

function ClassicThumb({ theme }: { theme: PaintedTheme }): React.JSX.Element {
  const c = CLASSIC[theme]
  const bar = (w: string, bg: string, h = 6): React.JSX.Element => <i className="block rounded-[2px]" style={{ width: w, height: h, background: bg }} />
  return (
    <span className="absolute inset-0" style={{ background: c.bg }}>
      <span className="absolute inset-x-0 top-0 h-[12px]" style={{ background: c.surface, borderBottom: `1px solid ${c.line}` }} />
      <span
        className="absolute bottom-0 left-0 top-[12px] grid w-[30%] content-start gap-[5px] px-[7px] pt-[8px]"
        style={{ background: c.surface, borderRight: `1px solid ${c.line}` }}
      >
        {bar('80%', c.line)}
        {bar('100%', c.accent)}
        {bar('90%', c.line)}
        {bar('70%', c.line)}
        {bar('85%', c.line)}
        {bar('60%', c.line)}
      </span>
      <span className="absolute bottom-0 left-[30%] right-[22%] top-[12px] grid content-start gap-[6px] px-3 pt-3" style={{ background: c.page }}>
        {bar('40%', c.strong, 6)}
        {bar('100%', c.line, 4)}
        {bar('94%', c.line, 4)}
        {bar('97%', c.line, 4)}
        {bar('66%', c.line, 4)}
      </span>
      <span className="absolute bottom-0 right-0 top-[12px] w-[22%]" style={{ background: c.surface, borderLeft: `1px solid ${c.line}` }} />
    </span>
  )
}
