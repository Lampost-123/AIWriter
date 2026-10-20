// The quick asks under a direction box (features/direction/DirectionComposer.tsx): a few chips that put a short ask in
// the box (Shorter, Longer, More dialogue…), pressed again to take it out, and More for the rest. As many show as the row
// has room for (at most CHIPS_SHOWN), worked out before the row is drawn and again as it narrows or widens; the others
// are in More. The row never wraps or changes height.
import * as P from '@radix-ui/react-popover'
import { useLayoutEffect, useRef, useState } from 'react'
import { ChevronDown } from '@/components/ui/icons'
import { cn } from '@/lib/cn'
import { CHIPS, CHIPS_SHOWN, hasAsk, type Chip } from './logic'

/** A chip's shape (the measuring copies have it too, so they measure the same). Its display is said apart: cn doesn't merge. */
const CHIP_SHAPE = 'h-6 shrink-0 items-center whitespace-nowrap rounded-full border px-2.5 text-[12px] leading-none'
/** The row's gap between its pieces, in px (gap-1.5). */
const GAP = 6

/** One quick ask. Pressed while its ask is in the box; pressing it again takes the ask out. */
export function ChipButton({
  chip,
  text,
  onToggle,
  hidden,
  disabled
}: {
  chip: Chip
  text: string
  /** `inPlace`: the keyboard stays where it is (pressed from the keyboard, or in a list that stays open). */
  onToggle: (chip: Chip, inPlace: boolean) => void
  /** No room for it on the row (it is in More instead). */
  hidden?: boolean
  disabled?: boolean
}): React.JSX.Element {
  const on = hasAsk(text, chip)
  return (
    <button
      type="button"
      data-chip={chip.id}
      aria-pressed={on}
      disabled={disabled}
      title={on ? `Take “${chip.ask}” out of the direction` : `Add “${chip.ask}” to the direction`}
      // The box keeps the keyboard when a chip is clicked, so Enter writes straight after.
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => onToggle(chip, e.detail === 0)}
      className={cn(
        CHIP_SHAPE,
        hidden ? 'hidden' : 'inline-flex',
        'outline-none transition-[background-color,border-color,color,scale] duration-(--dur-quick) ease-glide active:scale-[0.96] active:duration-(--dur-press)',
        'focus-visible:shadow-[inset_0_0_0_1.5px_var(--focus)] disabled:pointer-events-none disabled:opacity-50',
        on ? 'border-accent/45 bg-accent-soft text-fg' : 'border-line bg-surface text-muted hover:border-line-strong hover:text-fg'
      )}
    >
      {chip.label}
    </button>
  )
}

/**
 * How many of the first chips fit on the row beside More and what follows it: the chips are measured once (unseen
 * copies, and again once the fonts have loaded), the row whenever its width changes. Before the row is drawn, so the
 * first frame is already right.
 */
function useFit(
  row: React.RefObject<HTMLElement | null>,
  copies: React.RefObject<HTMLElement | null>,
  more: React.RefObject<HTMLElement | null>,
  after: React.RefObject<HTMLElement | null>
): number {
  const [n, setN] = useState(CHIPS_SHOWN)
  useLayoutEffect(() => {
    const el = row.current
    if (!el) return
    let widths: number[] = []
    const measureChips = (): void => {
      widths = [...(copies.current?.children ?? [])].map((c) => (c as HTMLElement).offsetWidth)
    }
    const fit = (): void => {
      const room = el.clientWidth - (more.current?.offsetWidth ?? 0) - (after.current ? after.current.offsetWidth + GAP : 0)
      let used = 0
      let count = 0
      for (const w of widths) {
        if (used + w + GAP > room) break
        used += w + GAP
        count++
      }
      setN(count)
    }
    measureChips()
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    let live = true
    void document.fonts?.ready.then(() => {
      if (!live) return
      measureChips()
      fit()
    })
    return () => {
      live = false
      ro.disconnect()
    }
  }, [row, copies, more, after])
  return n
}

export function QuickAsks({
  text,
  onToggle,
  side,
  disabled,
  trailing,
  onDone
}: {
  text: string
  onToggle: (chip: Chip, inPlace: boolean) => void
  side: 'top' | 'bottom'
  disabled?: boolean
  /** At the row's end (the directions given before). */
  trailing?: React.ReactNode
  /** More has closed: the keyboard goes back to the box. */
  onDone?: () => void
}): React.JSX.Element {
  const rowRef = useRef<HTMLDivElement>(null)
  const copiesRef = useRef<HTMLDivElement>(null)
  const moreRef = useRef<HTMLButtonElement>(null)
  const afterRef = useRef<HTMLDivElement>(null)
  const shown = useFit(rowRef, copiesRef, moreRef, afterRef)
  const rest = CHIPS.slice(shown)
  const restOn = rest.filter((c) => hasAsk(text, c)).length
  const [open, setOpen] = useState(false)
  return (
    <div ref={rowRef} className="relative flex h-6 min-w-0 items-center gap-1.5" role="group" aria-label="Quick asks">
      {/* Unseen copies of the first chips, measured to know how many fit. */}
      <div aria-hidden className="pointer-events-none invisible absolute left-0 top-0 h-0 w-0 overflow-hidden">
        <div ref={copiesRef} className="flex w-max">
          {CHIPS.slice(0, CHIPS_SHOWN).map((c) => (
            <span key={c.id} className={cn(CHIP_SHAPE, 'inline-flex')}>
              {c.label}
            </span>
          ))}
        </div>
      </div>
      {CHIPS.slice(0, CHIPS_SHOWN).map((c, i) => (
        <ChipButton key={c.id} chip={c} text={text} onToggle={onToggle} hidden={i >= shown} disabled={disabled} />
      ))}
      <P.Root open={open} onOpenChange={setOpen}>
        <P.Trigger asChild>
          <button
            ref={moreRef}
            type="button"
            disabled={disabled}
            aria-label={restOn ? `More quick asks (${restOn} in the direction)` : 'More quick asks'}
            title="More quick asks"
            className={cn(
              'inline-flex h-6 shrink-0 items-center gap-0.5 rounded-full px-2 text-[12px] leading-none outline-none transition-colors duration-150',
              'focus-visible:shadow-[inset_0_0_0_1.5px_var(--focus)] disabled:pointer-events-none disabled:opacity-50',
              open || restOn ? 'bg-surface-2 text-fg' : 'text-muted hover:bg-surface-2 hover:text-fg'
            )}
          >
            More
            {restOn ? <span className="ml-0.5 h-1.5 w-1.5 rounded-full bg-accent" aria-hidden /> : null}
            <ChevronDown size={12} aria-hidden />
          </button>
        </P.Trigger>
        <P.Portal>
          <P.Content
            side={side}
            align="start"
            sideOffset={6}
            collisionPadding={12}
            data-quick-asks=""
            onCloseAutoFocus={(e) => {
              if (!onDone) return
              e.preventDefault()
              onDone()
            }}
            className="z-50 w-[260px] rounded-xl border border-line bg-surface p-2.5 shadow-pop focus:outline-none data-[state=open]:animate-pop-in"
          >
            <p className="px-0.5 pb-2 text-[11.5px] leading-4 text-faint">
              Each adds a short ask to the direction. Press it again to take it out.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {/* In the list the keyboard stays where it is (the list stays open for another). */}
              {rest.map((c) => (
                <ChipButton key={c.id} chip={c} text={text} onToggle={(chip) => onToggle(chip, true)} disabled={disabled} />
              ))}
            </div>
          </P.Content>
        </P.Portal>
      </P.Root>
      {trailing ? (
        <div ref={afterRef} className="ml-auto flex shrink-0 items-center">
          {trailing}
        </div>
      ) : null}
    </div>
  )
}
