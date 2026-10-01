import * as P from '@radix-ui/react-popover'
import { Eye, Plus, X } from 'lucide-react'
import { memo, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Entry, ID } from '@shared/types'
import { cn } from '@/lib/cn'
import { filterEntries, normalizeName } from '@/features/world/entryLogic'

type Option = { type: 'entry'; entry: Entry } | { type: 'create'; name: string }

/** At most this many characters are listed at once; typing narrows the rest down. */
const MAX_SHOWN = 50
const nameOf = (c: Entry): string => c.name.trim() || 'Unnamed'

/**
 * Characters present in the scene, as chips. Typing filters the world's characters;
 * Enter picks the highlighted one, or adds the typed name as a new character.
 */
export const CastPicker = memo(function CastPicker({
  value,
  characters,
  povId,
  onChange,
  onCreate,
  id,
  'aria-describedby': describedBy
}: {
  value: ID[]
  characters: Entry[]
  povId: ID | null
  onChange: (ids: ID[]) => void
  /** Creates a character with this name and returns it (or null if that failed). */
  onCreate: (name: string) => Promise<Entry | null>
  id?: string
  'aria-describedby'?: string
}): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [focused, setFocused] = useState(false)
  const [highlight, setHighlight] = useState(0)
  const [dismissed, setDismissed] = useState(false)
  const [busy, setBusy] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const listId = `${id ?? 'cast'}-options`

  const byId = useMemo(() => new Map(characters.map((c) => [c.id, c])), [characters])
  const chosen = value.map((v) => byId.get(v)).filter((c): c is Entry => !!c)

  const { options, more } = useMemo(() => {
    const picked = new Set(value)
    const all = filterEntries(
      characters.filter((c) => !picked.has(c.id)),
      query
    )
    const list: Option[] = all.slice(0, MAX_SHOWN).map((entry) => ({ type: 'entry', entry }))
    const name = query.trim()
    const n = normalizeName(name)
    const exists = name && characters.some((c) => normalizeName(c.name) === n || c.aliases.some((a) => normalizeName(a) === n))
    if (name && !exists) list.push({ type: 'create', name })
    return { options: list, more: Math.max(0, all.length - MAX_SHOWN) }
  }, [characters, value, query])

  const open = focused && !dismissed && options.length > 0
  const hi = Math.min(highlight, Math.max(0, options.length - 1))

  // Keep the highlighted option in view while moving through a long list with the arrow keys.
  useLayoutEffect(() => {
    if (open) document.getElementById(`${listId}-${hi}`)?.scrollIntoView({ block: 'nearest' })
  }, [open, hi, listId])

  const choose = async (o: Option): Promise<void> => {
    if (o.type === 'entry') {
      onChange([...value, o.entry.id])
    } else {
      if (busy) return
      setBusy(true)
      const made = await onCreate(o.name)
      setBusy(false)
      if (made) onChange([...value, made.id])
    }
    setQuery('')
    setHighlight(0)
    input.current?.focus()
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
      if (query) setQuery('')
      else setDismissed(true)
    } else if (e.key === 'Backspace' && !query && chosen.length) {
      e.preventDefault()
      const last = chosen[chosen.length - 1]
      onChange(value.filter((v) => v !== last.id))
    }
  }

  return (
    <P.Root open={open}>
      <P.Anchor asChild>
        <div
          ref={box}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) {
              e.preventDefault()
              input.current?.focus()
            }
          }}
          className="flex min-h-8 w-full flex-wrap items-center gap-1 rounded-md border border-line bg-page px-1.5 py-1 transition-[border-color,box-shadow] duration-150 hover:border-line-strong focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20"
        >
          {chosen.map((c) => (
            <span key={c.id} className="inline-flex max-w-full items-center gap-1 rounded bg-accent-soft py-0.5 pl-2 pr-0.5 text-[12.5px] font-medium text-accent">
              {c.id === povId ? <Eye size={11} aria-label="Point of view" className="shrink-0" /> : null}
              <span className="truncate">{nameOf(c)}</span>
              <button
                type="button"
                aria-label={`Remove ${nameOf(c)}`}
                title="Remove"
                onClick={() => onChange(value.filter((v) => v !== c.id))}
                className="flex h-4 w-4 shrink-0 items-center justify-center rounded opacity-70 hover:bg-accent/15 hover:opacity-100"
              >
                <X size={11} />
              </button>
            </span>
          ))}
          <input
            ref={input}
            id={id}
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={open ? `${listId}-${hi}` : undefined}
            aria-describedby={describedBy}
            value={query}
            placeholder={chosen.length ? 'Add…' : 'Type a name…'}
            onChange={(e) => {
              setQuery(e.target.value)
              setHighlight(0)
              setDismissed(false)
            }}
            onFocus={() => {
              setFocused(true)
              setDismissed(false)
            }}
            onBlur={() => setFocused(false)}
            onKeyDown={onKeyDown}
            className="h-6 min-w-[80px] flex-1 bg-transparent px-1 text-[13.5px] text-fg placeholder:text-faint focus:outline-none"
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
          className="z-50 max-h-[260px] w-[var(--radix-popover-trigger-width)] overflow-y-auto rounded-lg border border-line bg-surface p-1 shadow-pop data-[state=open]:animate-pop-in"
        >
          <div id={listId} role="listbox" aria-label="Characters">
            {options.map((o, i) => (
              <div
                key={o.type === 'entry' ? o.entry.id : 'create'}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === hi}
                // Keep focus in the text box while clicking an option.
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setHighlight(i)}
                onClick={() => void choose(o)}
                className={cn('flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-[13px]', i === hi && 'bg-surface-2')}
              >
                {o.type === 'entry' ? (
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-fg">{nameOf(o.entry)}</span>
                    {o.entry.summary ? <span className="block truncate text-[12px] text-faint">{o.entry.summary}</span> : null}
                  </span>
                ) : (
                  <>
                    <Plus size={14} className="shrink-0 text-accent" />
                    <span className="min-w-0 flex-1 truncate text-fg">
                      Add "{o.name}" as a new character
                    </span>
                  </>
                )}
              </div>
            ))}
          </div>
          {more ? (
            <p className="px-2 pb-1 pt-1.5 text-[12px] text-faint">
              {more.toLocaleString('en-GB')} more. Keep typing to find them.
            </p>
          ) : null}
        </P.Content>
      </P.Portal>
    </P.Root>
  )
})
