// A word target typed as a number (Settings › Writing's default lengths, a chapter's target): an empty box is none,
// and shows what applies instead in grey.
import { useEffect, useState } from 'react'
import { Input } from '@/components/ui'
import { cleanTarget } from '@shared/lengths'

export function WordTargetInput({
  id,
  value,
  onChange,
  limits,
  placeholder,
  describedBy
}: {
  id: string
  value: number | null
  onChange: (n: number | null) => void
  limits: { min: number; max: number }
  placeholder: string
  describedBy?: string
}): React.JSX.Element {
  const [text, setText] = useState(value != null ? String(value) : '')
  useEffect(() => setText(value != null ? String(value) : ''), [value])
  return (
    <div className="flex items-center gap-1.5">
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        min={limits.min}
        max={limits.max}
        step={100}
        value={text}
        placeholder={placeholder}
        aria-describedby={describedBy}
        onChange={(e) => {
          setText(e.target.value)
          // An empty box is none.
          if (e.target.value.trim() === '') return onChange(null)
          const n = cleanTarget(e.target.value, limits)
          if (n != null) onChange(n)
        }}
        onBlur={() => setText(value != null ? String(value) : '')}
        className="w-[96px] tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      <span className="text-[13px] text-muted">words</span>
    </div>
  )
}
