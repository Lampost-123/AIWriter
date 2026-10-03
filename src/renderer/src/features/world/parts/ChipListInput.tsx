import { X } from '@/components/ui/icons'
import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/cn'
import { registerFlusher } from '@/lib/flush'

/** Splits pasted or typed text on commas and new lines. */
const split = (s: string): string[] =>
  s
    .split(/[,\n]/)
    .map((x) => x.trim())
    .filter(Boolean)

function addItems(list: string[], items: string[]): string[] {
  const seen = new Set(list.map((x) => x.toLocaleLowerCase()))
  const out = [...list]
  for (const it of items) {
    const k = it.toLocaleLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    out.push(it)
  }
  return out
}

/**
 * A list of short phrases shown as chips. Enter or a comma adds what's typed,
 * Backspace in the empty box removes the last one, and pasting a list adds each line.
 */
export function ChipListInput({
  value,
  onChange,
  placeholder,
  id,
  'aria-describedby': describedBy
}: {
  value: string[]
  onChange: (v: string[]) => void
  placeholder?: string
  id?: string
  'aria-describedby'?: string
}): React.JSX.Element {
  const [text, setText] = useState('')
  const input = useRef<HTMLInputElement>(null)

  const commit = (raw = text): void => {
    const items = split(raw)
    setText('')
    if (items.length) onChange(addItems(value, items))
  }

  // A phrase typed but not yet added (no Enter, no comma) still counts: it is added
  // before the window closes or the world switches, and when the box goes away.
  const latest = useRef({ text, value, onChange })
  latest.current = { text, value, onChange }
  useEffect(() => {
    const keep = (): void => {
      const { text: t, value: v, onChange: change } = latest.current
      const items = split(t)
      if (!items.length) return
      latest.current = { ...latest.current, text: '' }
      setText('')
      change(addItems(v, items))
    }
    const unregister = registerFlusher(keep)
    return () => {
      unregister()
      keep()
    }
  }, [])

  return (
    <div
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          e.preventDefault()
          input.current?.focus()
        }
      }}
      className="flex min-h-8 w-full flex-wrap items-center gap-1 rounded-md border border-line bg-page px-1.5 py-1 transition-[border-color,box-shadow] duration-150 hover:border-line-strong focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20"
    >
      {value.map((item, i) => (
        <span key={`${item}-${i}`} className="inline-flex max-w-full items-center gap-0.5 rounded bg-surface-2 py-0.5 pl-2 pr-0.5 text-[12.5px] text-fg">
          <span className="truncate">{item}</span>
          <button
            type="button"
            aria-label={`Remove "${item}"`}
            title="Remove"
            onClick={() => onChange(value.filter((_, j) => j !== i))}
            className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-faint hover:bg-surface-3 hover:text-fg"
          >
            <X size={11} />
          </button>
        </span>
      ))}
      <input
        ref={input}
        id={id}
        aria-describedby={describedBy}
        value={text}
        placeholder={value.length ? 'Add another…' : placeholder}
        onChange={(e) => {
          const v = e.target.value
          if (v.includes(',')) commit(v)
          else setText(v)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commit()
          } else if (e.key === 'Backspace' && !text && value.length) {
            e.preventDefault()
            onChange(value.slice(0, -1))
          }
        }}
        onPaste={(e) => {
          const pasted = e.clipboardData.getData('text')
          if (/[,\n]/.test(pasted)) {
            e.preventDefault()
            commit(text + pasted)
          }
        }}
        onBlur={() => commit()}
        className={cn('h-6 min-w-[120px] flex-1 bg-transparent px-1 text-[13.5px] text-fg placeholder:text-faint focus:outline-none')}
      />
    </div>
  )
}
