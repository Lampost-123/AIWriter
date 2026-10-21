import { forwardRef, memo, useRef } from 'react'
import { useFitHeight } from '@/components/ui/useFitHeight'

/**
 * An entry's name, as a title, on the panels' entry page (EntryForm) and the desk's dossier. It wraps onto more lines
 * rather than cut off a long one ("The night the harbour burned", "Who left the letter on Mara's pillow?"), grows with
 * it and fits again when its panel is resized, and stays one line of text: Enter does nothing, and a pasted line break
 * becomes a space. Each page gives it its own look (`className`).
 */
export const NameBox = memo(
  forwardRef<HTMLTextAreaElement, { value: string; onChange: (v: string) => void; className: string }>(function NameBox(
    { value, onChange, className },
    outer
  ) {
    const inner = useRef<HTMLTextAreaElement | null>(null)
    useFitHeight(inner, value, 1, 4)
    return (
      <textarea
        ref={(el) => {
          inner.current = el
          if (typeof outer === 'function') outer(el)
          else if (outer) outer.current = el
        }}
        rows={1}
        value={value}
        aria-label="Name"
        placeholder="Name"
        spellCheck={false}
        onChange={(e) => onChange(e.target.value.replace(/[ \t]*[\r\n]+[ \t]*/g, ' '))}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) e.preventDefault()
        }}
        className={className}
      />
    )
  })
)
