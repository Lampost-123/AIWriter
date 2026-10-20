// The direction composer (overhaul, 2026-10-19): the one box Adam tells the AI what to write in, used everywhere he
// does (Generate's draft options, the desk's steer box, a beat's note, Variants, the AI edits' Rewrite and Continue).
// - Enter writes (Shift+Enter starts a new line); ↑ in an empty box brings back the last direction given (↑ again, the
//   one before; ↓ comes back). Dictation types into it as into any box.
// - Quick asks under it (Shorter, Longer, More dialogue…; the rest behind More) put a short ask in the box, and take it
//   out when pressed again. With the pointer they go in as typing does, so Ctrl+Z in the box takes one back.
// - Recent (the clock) lists the directions given before in this story, searchable, newest first, the same words once,
//   with the starred ones first; a star keeps one for every story (Adam's writing preferences, outside every world).
// Where there's no room for the row under it (the desk's dock), one button beside the box holds both.
import * as P from '@radix-ui/react-popover'
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { History } from '@/components/ui/icons'
import { Textarea } from '@/components/ui'
import { cn } from '@/lib/cn'
import { useApp } from '@/lib/store'
import { CHIPS, NO_HISTORY, addAsk, historyStep, toggleChip, type Chip, type HistoryState } from './logic'
import { ChipButton, QuickAsks } from './QuickAsks'
import { RecentList } from './RecentList'
import { loadFavourites, loadRecents, scopeOf, useRecentDirections, watchDraftDirections, type BoxKind } from './store'
import { typeInto } from './typeInto'
import './direction.css'

type Box = HTMLTextAreaElement | HTMLInputElement

/** The box's own field styling (as Input and Textarea have it), for a one-line box. */
const FIELD =
  'w-full rounded-md border border-line bg-page px-2.5 text-[13.5px] text-fg placeholder:text-faint transition-[border-color,box-shadow] duration-150 hover:border-line-strong focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 disabled:opacity-60'

export interface DirectionComposerProps {
  value: string
  onChange: (text: string) => void
  /** Enter (with no Shift, Ctrl or Alt): write with the direction. Left out, Enter makes a new line. */
  onSubmit?: () => void
  /** Keys the caller handles first (Ctrl+Enter, say); one it prevents goes no further. */
  onKeyDown?: (e: React.KeyboardEvent<Box>) => void
  /** Which directions it offers back: for writing on (the default), or for rewriting chosen words. */
  kind?: BoxKind
  /** One line, or a box that grows between minRows and maxRows. */
  lines?: 'one' | 'many'
  minRows?: number
  maxRows?: number
  /** The quick asks and Recent: a row under the box, one button beside it holding both, or neither (↑ still works). */
  tools?: 'row' | 'menu' | 'none'
  /** A label shown above the box; without one, `ariaLabel` names it. */
  label?: string
  ariaLabel?: string
  placeholder?: string
  id?: string
  className?: string
  /** The box's own classes (with `bare`, all of them). */
  boxClassName?: string
  /** The caller styles the box itself (the desk's dock). */
  bare?: boolean
  disabled?: boolean
  maxLength?: number
  /** Beside the box (a button that writes with it). */
  trailing?: ReactNode
  /** Where its lists open: above it at the foot of the page (the dock, the beat bar). */
  side?: 'top' | 'bottom'
  boxRef?: React.Ref<Box>
  /** Tools' buttons sit after the box: the menu button's own classes. */
  menuClassName?: string
}

/** Gives the box to the caller's ref as well as ours. */
function setRef(ref: React.Ref<Box> | undefined, el: Box | null): void {
  if (typeof ref === 'function') ref(el)
  else if (ref) (ref as React.RefObject<Box | null>).current = el
}

export function DirectionComposer({
  value,
  onChange,
  onSubmit,
  onKeyDown,
  kind = 'scene',
  lines = 'many',
  minRows = 2,
  maxRows = 6,
  tools = 'row',
  label,
  ariaLabel,
  placeholder,
  id,
  className,
  boxClassName,
  bare,
  disabled,
  maxLength = 2000,
  trailing,
  side = 'bottom',
  boxRef,
  menuClassName
}: DirectionComposerProps): React.JSX.Element {
  const autoId = useId()
  const boxId = id ?? `direction-${autoId}`
  const inner = useRef<Box | null>(null)
  const valueRef = useRef(value)
  valueRef.current = value
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const recents = useRecentDirections(kind)
  const history = useMemo(() => recents.map((r) => r.text), [recents])
  const hist = useRef<HistoryState>(NO_HISTORY)
  /** The box's words were just set from a list or ↑: the caret goes to their end (and the box takes the keyboard). */
  const caretToEnd = useRef<'focus' | 'caret' | null>(null)
  const [recentOpen, setRecentOpen] = useState(false)
  const picked = useRef(false)

  // What it offers back: read once it shows, and again for another world or story.
  const scope = useApp((s) => scopeOf(kind, s))
  useEffect(() => {
    watchDraftDirections()
    void loadFavourites()
    void loadRecents(kind)
  }, [kind, scope])

  useLayoutEffect(() => {
    const how = caretToEnd.current
    const el = inner.current
    if (!how || !el) return
    caretToEnd.current = null
    if (how === 'focus' && document.activeElement !== el) el.focus({ preventScroll: true })
    const n = el.value.length
    el.setSelectionRange(n, n)
  }, [value])

  const set = (text: string, how: 'focus' | 'caret' | null = null): void => {
    if (text === valueRef.current) {
      // Nothing changes, so nothing is drawn again: the keyboard goes back to the box here and now.
      if (how === 'focus') inner.current?.focus({ preventScroll: true })
      return
    }
    caretToEnd.current = how
    onChangeRef.current(text)
  }

  /** A quick ask pressed: with the pointer it goes in as typing does (Ctrl+Z takes it back); from a list or the keys, at once. */
  const toggle = (chip: Chip, inPlace: boolean): void => {
    hist.current = NO_HISTORY
    const next = toggleChip(valueRef.current, chip)
    const el = inner.current
    if (!inPlace && el && !el.disabled) typeInto(el, next, (t) => onChangeRef.current(t))
    else set(next)
  }

  /** A direction given before, picked from the list: the box's words if it is empty, else after them. */
  const pick = (text: string): void => {
    hist.current = NO_HISTORY
    picked.current = true
    setRecentOpen(false)
    const cur = valueRef.current
    set(cur.trim() ? addAsk(cur, text) : text, 'focus')
  }

  const keyDown = (e: React.KeyboardEvent<Box>): void => {
    onKeyDown?.(e)
    if (e.defaultPrevented || e.nativeEvent.isComposing) return
    // Only the keys alone: with Shift, Ctrl or Alt they are the box's own (a new line) or the app's.
    const alone = !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey
    if (!alone) return
    if (e.key === 'Enter' && onSubmit) {
      e.preventDefault()
      onSubmit()
      return
    }
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
    const el = e.currentTarget
    const start = el.selectionStart ?? 0
    const end = el.selectionEnd ?? 0
    if (start !== end) return
    const older = e.key === 'ArrowUp'
    // Within a box of several lines, ↑ and ↓ move between them as usual; only from its first (or last) line do they step.
    if (older ? el.value.slice(0, start).includes('\n') : el.value.slice(end).includes('\n')) return
    const step = historyStep(hist.current, el.value, older ? 'older' : 'newer', history)
    if (!step) return
    e.preventDefault()
    e.stopPropagation()
    hist.current = step.state
    set(step.value, 'caret')
  }

  const common = {
    id: boxId,
    value,
    placeholder,
    disabled,
    maxLength,
    spellCheck: true,
    autoComplete: 'off',
    'aria-label': label ? undefined : ariaLabel,
    'data-direction-box': kind,
    onFocus: () => void loadRecents(kind),
    onKeyDown: keyDown
  } as const

  const box =
    lines === 'one' ? (
      <input
        ref={(el) => {
          inner.current = el
          setRef(boxRef, el)
        }}
        type="text"
        {...common}
        onChange={(e) => {
          hist.current = NO_HISTORY
          onChange(e.target.value)
        }}
        className={bare ? boxClassName : cn(FIELD, 'h-8 min-w-0 flex-1', boxClassName)}
      />
    ) : (
      <Textarea
        ref={(el) => {
          inner.current = el
          setRef(boxRef, el)
        }}
        minRows={minRows}
        maxRows={maxRows}
        {...common}
        onChange={(e) => {
          hist.current = NO_HISTORY
          onChange(e.target.value)
        }}
        className={cn('min-w-0 flex-1', boxClassName)}
      />
    )

  const recentList = (
    <RecentList
      recents={recents}
      onPick={pick}
      heading={
        tools === 'menu' ? (
          <div className="mb-3">
            <p className="px-0.5 pb-2 text-[11.5px] font-semibold uppercase tracking-[0.06em] text-faint">Quick asks</p>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Quick asks">
              {CHIPS.map((c) => (
                <ChipButton key={c.id} chip={c} text={value} onToggle={(chip) => toggle(chip, true)} disabled={disabled} />
              ))}
            </div>
          </div>
        ) : null
      }
    />
  )

  const popover = (trigger: ReactNode): React.JSX.Element => (
    <P.Root open={recentOpen} onOpenChange={setRecentOpen}>
      <P.Trigger asChild>{trigger}</P.Trigger>
      <P.Portal>
        <P.Content
          side={side}
          align="end"
          sideOffset={6}
          collisionPadding={12}
          data-recent-directions=""
          onOpenAutoFocus={(e) => {
            // The search box takes the keyboard.
            e.preventDefault()
            const el = e.currentTarget instanceof HTMLElement ? e.currentTarget : null
            el?.querySelector<HTMLElement>('[data-direction-search]')?.focus({ preventScroll: true })
          }}
          onCloseAutoFocus={(e) => {
            // A direction picked: the keyboard is in the box, after its words, ready for Enter.
            if (!picked.current) return
            picked.current = false
            e.preventDefault()
            inner.current?.focus({ preventScroll: true })
          }}
          className="z-50 w-[360px] max-w-[calc(100vw-24px)] rounded-xl border border-line bg-surface p-3 shadow-pop focus:outline-none data-[state=open]:animate-pop-in"
        >
          {recentList}
          <p className="mt-2 border-t border-line pt-2 text-[11.5px] leading-4 text-faint">
            Tip: ↑ in the empty box brings back your last direction.
          </p>
        </P.Content>
      </P.Portal>
    </P.Root>
  )

  const recentButton = popover(
    <button
      type="button"
      disabled={disabled}
      aria-label="Your recent directions"
      title="Your recent directions (↑ in the empty box brings back the last one)"
      onMouseDown={(e) => {
        // Opened from the box with the pointer: the box keeps its place in the tab order.
        if (document.activeElement === inner.current) e.preventDefault()
      }}
      className={cn(
        'inline-flex h-6 shrink-0 items-center gap-1 rounded-full px-2 text-[12px] leading-none outline-none transition-colors duration-150',
        'focus-visible:shadow-[inset_0_0_0_1.5px_var(--focus)] disabled:pointer-events-none disabled:opacity-50',
        recentOpen ? 'bg-surface-2 text-fg' : 'text-muted hover:bg-surface-2 hover:text-fg'
      )}
    >
      <History size={13} aria-hidden />
      Recent
    </button>
  )

  if (tools === 'menu') {
    return (
      <div className={cn('flex min-w-0 items-center gap-1', className)}>
        {box}
        {popover(
          <button
            type="button"
            disabled={disabled}
            aria-label="Quick asks and your recent directions"
            title="Quick asks and your recent directions (↑ in the empty box brings back the last one)"
            className={cn(menuClassName, recentOpen && 'is-open')}
          >
            <History size={16} aria-hidden />
          </button>
        )}
        {trailing}
      </div>
    )
  }

  return (
    <div className={cn('flex min-w-0 flex-col', className)}>
      {label ? (
        <label htmlFor={boxId} className="mb-1 text-[12px] font-medium text-muted">
          {label}
        </label>
      ) : null}
      <div className="flex min-w-0 items-start gap-2">
        {box}
        {trailing}
      </div>
      {tools === 'row' ? (
        <div className="mt-1.5">
          <QuickAsks
            text={value}
            onToggle={toggle}
            side={side}
            disabled={disabled}
            trailing={recentButton}
            onDone={() => inner.current?.focus({ preventScroll: true })}
          />
        </div>
      ) : null}
    </div>
  )
}
