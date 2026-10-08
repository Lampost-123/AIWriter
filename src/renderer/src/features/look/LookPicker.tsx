// Settings › Appearance › Style: the New look or Classic, picked from two small pictures of the window. A pick shows
// at once and is kept for next time (the window then opens in it). Like the accent swatches, the two are a radio
// group: the arrow keys move between them and pick.
// Under it, in the New look (and only in a build where the desk can be chosen): Layout, the desk or the panels, picked
// the same way. It waits while a draft or an AI change is being written, so nothing is pulled from under it.
import { useId, useRef } from 'react'
import type { PaintedTheme } from '@shared/api'
import { arrangementOf, lookOf, type Arrangement, type Look } from '@shared/contracts/look'
import { cn } from '@/lib/cn'
import { editorBridge } from '@/lib/editorBridge'
import { useApp } from '@/lib/store'
import { useBeats } from '@/features/beats/session'
import { useDraft } from '@/features/generate/draftRun'
import { usePaintedTheme } from './AccentPicker'
import { applyArrangement, applyLook, deskReady } from './look'

const CHOICES: { look: Look; label: string; hint: string }[] = [
  { look: 'new', label: 'New look', hint: 'Depth, colour and motion' },
  { look: 'classic', label: 'Classic', hint: 'The look you know, flat and quiet' }
]

const LAYOUTS: { arrangement: Arrangement; label: string; hint: string }[] = [
  { arrangement: 'desk', label: 'Desk', hint: 'The page in the middle, the story down a slim spine' },
  { arrangement: 'panels', label: 'Panels', hint: 'Areas down the side, the scene panel beside the page' }
]

/** Picks a look: painted at once, then saved (and the one-time note about the New look is done with). */
export function chooseLook(look: Look): void {
  const app = useApp.getState()
  applyLook(look)
  if (app.settings) useApp.setState({ settings: { ...app.settings, look, lookNote: false } })
  void app.updateSettings({ look, lookNote: false })
}

/** True while a draft, a beat or an AI change is being written into the page: the layout waits until it is done. */
function useWriting(): boolean {
  const generation = useApp((s) => s.activeGeneration !== null)
  const drafting = useDraft((s) => s.phase !== 'idle')
  const beats = useBeats((s) => {
    const phase = s.session?.phase
    return phase === 'starting' || phase === 'writing' || phase === 'stopping'
  })
  return generation || drafting || beats
}

/** Picks a layout: painted at once, then saved (and the one-time note about the desk is done with). Not while writing. */
export function chooseArrangement(arrangement: Arrangement): void {
  if (editorBridge()?.busy()) return
  const app = useApp.getState()
  applyArrangement(arrangement)
  if (app.settings) useApp.setState({ settings: { ...app.settings, arrangement, arrangementNote: false } })
  void app.updateSettings({ arrangement, arrangementNote: false })
}

/** A small radio group of pictured choices (Style, Layout): the arrow keys move between them and pick. */
function PictureChoices<T extends string>({
  label,
  choices,
  value,
  onChoose,
  disabled,
  note,
  picture
}: {
  label: string
  choices: { id: T; label: string; hint: string }[]
  value: T
  onChoose: (id: T) => void
  disabled?: boolean
  /** Said under the choices (why they can't be changed now). */
  note?: string
  picture: (id: T) => React.ReactNode
}): React.JSX.Element {
  const labelId = useId()
  const noteId = useId()
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const index = choices.findIndex((c) => c.id === value)

  const onKeyDown = (e: React.KeyboardEvent): void => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (!step || disabled) return
    e.preventDefault()
    const next = (index + step + choices.length) % choices.length
    onChoose(choices[next].id)
    refs.current[next]?.focus()
  }

  return (
    <div className="flex flex-col gap-1">
      <span id={labelId} className="text-[12px] font-medium text-muted">
        {label}
      </span>
      <div
        role="radiogroup"
        aria-labelledby={labelId}
        aria-describedby={note ? noteId : undefined}
        aria-disabled={disabled || undefined}
        onKeyDown={onKeyDown}
        className="grid grid-cols-2 gap-3 py-1.5"
      >
        {choices.map((c, i) => {
          const on = c.id === value
          return (
            <button
              key={c.id}
              ref={(el) => {
                refs.current[i] = el
              }}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={c.label}
              tabIndex={on ? 0 : -1}
              disabled={disabled && !on}
              onClick={() => !disabled && onChoose(c.id)}
              className={cn(
                // In both looks: it lifts on hover and presses in quickly (90ms), coming back softly (150ms). (translate-* and
                // scale-* are the CSS translate and scale properties, so they are listed.) A disabled choice stays still.
                'group flex flex-col overflow-hidden rounded-card bg-page text-left transition-[box-shadow,transform,translate,scale] duration-(--dur-quick) ease-press',
                'shadow-e1 enabled:hover:-translate-y-0.5 enabled:hover:shadow-e2 enabled:active:duration-(--dur-press) enabled:active:scale-[0.98] disabled:opacity-60',
                on ? 'ring-2 ring-accent' : 'ring-1 ring-line'
              )}
            >
              <span aria-hidden className="relative block h-[104px] overflow-hidden">
                {picture(c.id)}
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
      {note ? (
        <p id={noteId} className="text-[12px] text-faint">
          {note}
        </p>
      ) : null}
    </div>
  )
}

export function LookPicker(): React.JSX.Element | null {
  const look = useApp((s) => (s.settings ? lookOf(s.settings.look) : null))
  const arrangement = useApp((s) => (s.settings ? arrangementOf(s.settings.arrangement) : null))
  const theme = usePaintedTheme()
  const writing = useWriting()
  if (!look || !arrangement) return null
  return (
    <>
      <PictureChoices
        label="Style"
        choices={CHOICES.map((c) => ({ id: c.look, label: c.label, hint: c.hint }))}
        value={look}
        onChoose={chooseLook}
        picture={(id) => (id === 'new' ? <NewThumb theme={theme} /> : <ClassicThumb theme={theme} />)}
      />
      {/* The New look's layout: only in the New look, and only where the desk can be chosen yet. */}
      {look === 'new' && deskReady() ? (
        <PictureChoices
          label="Layout"
          choices={LAYOUTS.map((c) => ({ id: c.arrangement, label: c.label, hint: c.hint }))}
          value={arrangement}
          onChoose={chooseArrangement}
          disabled={writing}
          note={writing ? 'Finish or stop the draft first, then pick a layout.' : undefined}
          picture={(id) => (id === 'desk' ? <DeskThumb theme={theme} /> : <NewThumb theme={theme} />)}
        />
      ) : null}
    </>
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
/** The desk's colours per theme: the lit frame, the dark spine, the paper and the ink (layout/desk/desk.css: blue in Light and Dark, warm in Sepia). */
const DESK: Record<PaintedTheme, { frame: string; glow: string; spine: string; page: string; ink: string; line: string; pill: string }> = {
  light: { frame: '#d8dee7', glow: 'rgb(255 255 255 / 0.7)', spine: '#212b44', page: '#fafbfc', ink: '#1b2130', line: '#c2cad6', pill: '#ffffff' },
  dark: { frame: '#0d1220', glow: 'rgb(78 104 150 / 0.45)', spine: '#24304f', page: '#182033', ink: '#e8ecf4', line: '#3a4663', pill: '#1f2940' },
  sepia: { frame: '#dccdae', glow: 'rgb(255 214 150 / 0.55)', spine: '#3b2c1e', page: '#faf4e5', ink: '#3b2f22', line: '#cdbd9b', pill: '#faf4e5' }
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

/** The desk: the rooms in the middle of the top bar, the story's dark spine, and the page as a sheet in the lamp light. */
function DeskThumb({ theme }: { theme: PaintedTheme }): React.JSX.Element {
  const c = DESK[theme]
  const bar = (w: string, bg: string, extra?: React.CSSProperties): React.JSX.Element => (
    <i className="block h-[4px] rounded-[2px]" style={{ width: w, background: bg, ...extra }} />
  )
  return (
    <span className="absolute inset-0" style={{ background: `radial-gradient(70% 60% at 52% 18%, ${c.glow}, transparent 70%), ${c.frame}` }}>
      <span className="absolute left-1/2 top-[4px] flex h-[7px] w-[36px] -translate-x-1/2 rounded-[3px] p-[1px]" style={{ background: c.line }}>
        <i className="block w-[10px] rounded-[2px]" style={{ background: c.pill }} />
      </span>
      <span
        className="absolute bottom-[8px] left-[7px] top-[16px] grid w-[10px] content-start justify-items-center gap-[4px] rounded-full pt-[7px]"
        style={{ background: c.spine }}
      >
        {[1, 1, 0, 1, 1, 1].map((r, i) =>
          r ? (
            <i key={i} className="block h-[4px] w-[4px] rounded-full" style={{ boxShadow: 'inset 0 0 0 1px rgb(255 248 236 / 0.7)' }} />
          ) : (
            <i key={i} className="block h-[2px]" />
          )
        )}
      </span>
      <span
        className="absolute bottom-0 left-[27%] right-[21%] top-[15px] rounded-t-[6px] px-3 pt-3"
        style={{ background: c.page, boxShadow: '0 4px 14px rgb(60 40 15 / 0.2), 0 0 0 1px rgb(60 40 15 / 0.05)' }}
      >
        {bar('30%', c.ink, { opacity: 0.35, height: 3 })}
        <span className="mt-1.5 block">{bar('55%', c.ink, { height: 7, opacity: 0.8 })}</span>
        <span className="mt-2 grid gap-[5px]">
          {bar('100%', c.line)}
          {bar('94%', c.line)}
          {bar('97%', c.line)}
          {bar('72%', c.line)}
        </span>
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
