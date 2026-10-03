// The length box in Generate's draft options and on the Variants page. Empty with "Auto" in it, the
// AI picks the length the scene needs; a number sets one for this draft. Beside it, where the length
// comes from: the scene card, or a button to go back to the card's.

import { useEffect, useId, useState, type RefObject } from 'react'
import { Field, Input } from '@/components/ui'
import { cn } from '@/lib/cn'
import { draftLength, type SceneDraftOptions } from './draftOptions'

type Length = SceneDraftOptions['targetWords']

export function LengthField({
  label = 'Length',
  value,
  cardWords,
  onChange,
  inputRef,
  onTyped,
  className
}: {
  label?: string
  /** The draft options' length: null follows the scene card, 'auto' is Auto, a number is set. */
  value: Length
  /** The scene card's length (cardLength): a word count, null for Auto, undefined until it is read. */
  cardWords: number | null | undefined
  onChange: (value: Length) => void
  inputRef?: RefObject<HTMLInputElement | null>
  /** Called as Adam types in the box. */
  onTyped?: () => void
  className?: string
}): React.JSX.Element {
  const loaded = cardWords !== undefined
  // Until the card is read, a length that follows it isn't known yet: the box stays blank rather than flash "Auto".
  const known = loaded || value != null
  const length = draftLength({ direction: '', creativity: null, targetWords: value }, cardWords ?? null)
  const auto = known && length == null
  const shown = length != null ? String(length) : ''
  const [text, setText] = useState(shown)
  const hintId = useId()
  useEffect(() => setText(shown), [shown])

  const fromCard = value == null || (value === 'auto' ? cardWords === null : value === cardWords)
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <div className="flex items-end gap-3">
        <Field label={label} className="w-[132px] shrink-0">
          {(id) => (
            <div className="relative">
              <Input
                id={id}
                ref={inputRef}
                inputMode="numeric"
                value={text}
                placeholder={known ? 'Auto' : undefined}
                aria-describedby={hintId}
                onChange={(e) => {
                  onTyped?.()
                  const v = e.target.value.replace(/[^\d]/g, '').slice(0, 5)
                  setText(v)
                  // An empty box is Auto: the card's own when the card is on Auto.
                  if (!v) onChange(cardWords === null ? null : 'auto')
                  const n = parseInt(v, 10)
                  if (n >= 100) onChange(Math.min(n, 12000))
                }}
                onBlur={() => setText(shown)}
                className="pr-12 tabular-nums"
              />
              {text ? (
                <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[12px] text-faint">words</span>
              ) : null}
            </div>
          )}
        </Field>
        <div className="mb-[7px] min-w-0 text-[12px]">
          {!loaded ? null : fromCard ? (
            <span className="text-faint">From the scene card</span>
          ) : (
            <button type="button" className="text-accent hover:underline" onClick={() => onChange(null)}>
              {cardWords != null ? `Use the card's ${cardWords.toLocaleString()}` : 'Back to Auto'}
            </button>
          )}
        </div>
      </div>
      {/* One line either way, so nothing moves as the box changes between Auto and a number. */}
      <p id={hintId} className={cn('text-[12px] leading-[18px] text-faint', !known && 'invisible')}>
        {auto || !known ? 'Auto: the AI picks the length the scene needs.' : 'Clear the box to let the AI pick the length.'}
      </p>
    </div>
  )
}
