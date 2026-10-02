import * as P from '@radix-ui/react-popover'
import { Plus } from 'lucide-react'
import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/cn'

export interface ComboOption {
  key: string
  label: string
  /** A quieter second line (what kind of entry it is, its summary). */
  sub?: string
  /** An icon before the label. */
  icon?: ReactNode
  /** Makes something new from what was typed (shown with a plus). */
  create?: boolean
}

/**
 * A text box that offers a list as Adam types, like the cast picker on the scene card: arrow keys
 * move through it, Enter picks, Escape clears the text and then closes the list. The caller filters
 * the options for `query`, so it decides what matches and which "Add … as new" choices to offer.
 */
export function Combobox({
  query,
  onQuery,
  options,
  more = 0,
  onPick,
  label,
  listLabel,
  placeholder,
  refocus = true,
  id,
  'aria-describedby': describedBy
}: {
  query: string
  onQuery: (q: string) => void
  options: ComboOption[]
  /** How many more matches there are than are listed. */
  more?: number
  /** Picks an option. The text is cleared once it resolves; if it throws, the text stays (say why yourself). */
  onPick: (o: ComboOption) => Promise<void> | void
  /** The text box's name for screen readers, when no <label> names it. */
  label?: string
  /** The list's name for screen readers. */
  listLabel: string
  placeholder?: string
  /** Keep focus in the text box after a pick (false when the pick moves focus elsewhere). */
  refocus?: boolean
  id?: string
  'aria-describedby'?: string
}): React.JSX.Element {
  const [focused, setFocused] = useState(false)
  const [highlight, setHighlight] = useState(0)
  const [dismissed, setDismissed] = useState(false)
  const [busy, setBusy] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const autoId = useId()
  const listId = `${id ?? autoId}-options`

  const open = focused && !dismissed && options.length > 0
  const hi = Math.min(highlight, Math.max(0, options.length - 1))

  // Keep the highlighted option in view while moving through a long list with the arrow keys.
  useLayoutEffect(() => {
    if (open) document.getElementById(`${listId}-${hi}`)?.scrollIntoView({ block: 'nearest' })
  }, [open, hi, listId])

  const choose = async (o: ComboOption): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      await onPick(o)
    } catch {
      // The caller says what went wrong; the typed text stays so it can be tried again.
      return
    } finally {
      setBusy(false)
    }
    onQuery('')
    setHighlight(0)
    if (refocus) input.current?.focus()
    else setDismissed(true)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'ArrowDown' && options.length) {
      e.preventDefault()
      if (!open) return setDismissed(false)
      setHighlight((hi + 1) % options.length)
    } else if (e.key === 'ArrowUp' && options.length) {
      e.preventDefault()
      setHighlight((hi - 1 + options.length) % options.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (open && options[hi]) void choose(options[hi])
    } else if (e.key === 'Escape' && (query || open)) {
      // Handled here, so it doesn't also reach shortcuts elsewhere in the window.
      e.preventDefault()
      e.stopPropagation()
      if (query) onQuery('')
      else setDismissed(true)
    }
  }

  return (
    <P.Root open={open}>
      <P.Anchor asChild>
        <div ref={box} className="w-full">
          <input
            ref={input}
            id={id}
            role="combobox"
            aria-label={label}
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={open ? `${listId}-${hi}` : undefined}
            aria-describedby={describedBy}
            aria-busy={busy || undefined}
            value={query}
            placeholder={placeholder}
            onChange={(e) => {
              onQuery(e.target.value)
              setHighlight(0)
              setDismissed(false)
            }}
            onFocus={() => {
              setFocused(true)
              setDismissed(false)
            }}
            onBlur={() => setFocused(false)}
            // Clicking the box again brings back a list that Escape closed.
            onMouseDown={() => setDismissed(false)}
            onKeyDown={onKeyDown}
            className="h-8 w-full rounded-md border border-line bg-page px-2.5 text-[13.5px] text-fg transition-[border-color,box-shadow] duration-150 placeholder:text-faint hover:border-line-strong focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
          />
        </div>
      </P.Anchor>
      <P.Portal>
        <P.Content
          align="start"
          sideOffset={4}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
          onInteractOutside={(e) => {
            if (box.current?.contains(e.target as Node)) e.preventDefault()
          }}
          // Keep focus in the text box while using the list's scroll bar, so the list stays open.
          onMouseDown={(e) => e.preventDefault()}
          className="z-50 max-h-[260px] w-[var(--radix-popover-trigger-width)] overflow-y-auto rounded-lg border border-line bg-surface p-1 shadow-pop data-[state=open]:animate-pop-in"
        >
          <div id={listId} role="listbox" aria-label={listLabel}>
            {options.map((o, i) => (
              <div
                key={o.key}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === hi}
                // Keep focus in the text box while clicking an option.
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setHighlight(i)}
                onClick={() => void choose(o)}
                className={cn('flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-[13px]', i === hi && 'bg-surface-2')}
              >
                {o.create ? (
                  <Plus size={14} className="mt-[3px] shrink-0 self-start text-accent" aria-hidden />
                ) : o.icon ? (
                  <span className="mt-[3px] shrink-0 self-start text-faint" aria-hidden>
                    {o.icon}
                  </span>
                ) : null}
                <span className="min-w-0 flex-1">
                  <span className={cn('block text-fg', o.create ? 'break-words' : 'truncate')}>{o.label}</span>
                  {o.sub ? <span className="block truncate text-[12px] text-faint">{o.sub}</span> : null}
                </span>
              </div>
            ))}
          </div>
          {more ? (
            <p className="px-2 pb-1 pt-1.5 text-[12px] text-faint">{more.toLocaleString('en-GB')} more. Keep typing to find them.</p>
          ) : null}
        </P.Content>
      </P.Portal>
    </P.Root>
  )
}
