import { forwardRef, useRef } from 'react'
import { Textarea, type TextareaProps } from '@/components/ui'
import { useFitHeight } from '@/components/ui/useFitHeight'

export { useFitHeight }

/** The design system's Textarea, growing with its text and staying right when its panel is resized. */
export const AutoTextarea = forwardRef<HTMLTextAreaElement, Omit<TextareaProps, 'autoGrow'>>(function AutoTextarea(
  { minRows = 2, maxRows = 16, value, ...rest },
  outerRef
) {
  const inner = useRef<HTMLTextAreaElement | null>(null)
  useFitHeight(inner, value, minRows, maxRows)
  return (
    <Textarea
      ref={(el) => {
        inner.current = el
        if (typeof outerRef === 'function') outerRef(el)
        else if (outerRef) outerRef.current = el
      }}
      autoGrow={false}
      minRows={minRows}
      maxRows={maxRows}
      value={value}
      {...rest}
    />
  )
})
