// The export dialogs' format in the New look: a row of small file cards (a page with the file's kind on its corner),
// one radio group, the arrow keys moving and picking as in Classic's segmented control (the same names: Word, EPUB...).
// The chosen one's hint shows under the row (ExportDialogs.tsx). Classic keeps the segmented control.
import { useRef } from 'react'
import { cn } from '@/lib/cn'
import './transfer.css'

const BADGES: Record<string, string> = { docx: 'DOCX', epub: 'EPUB', pdf: 'PDF', markdown: 'MD', text: 'TXT' }

export function FormatCards<T extends string>({
  label,
  value,
  onChange,
  options
}: {
  label: string
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string }[]
}): React.JSX.Element {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const index = Math.max(0, options.findIndex((o) => o.value === value))
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="ex-formats"
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, ${options.length < 3 ? '120px' : '1fr'}))` }}
      onKeyDown={(e) => {
        const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
        if (!step) return
        e.preventDefault()
        const next = (index + step + options.length) % options.length
        onChange(options[next].value)
        refs.current[next]?.focus()
      }}
    >
      {options.map((o, i) => {
        const on = o.value === value
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el
            }}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={o.label}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(o.value)}
            className={cn('ex-format', on && 'is-on')}
          >
            <span aria-hidden className="ex-file">
              <b>{BADGES[o.value] ?? o.value.toUpperCase()}</b>
            </span>
            <span className="text-[12.5px] font-medium">{o.label}</span>
          </button>
        )
      })}
    </div>
  )
}
