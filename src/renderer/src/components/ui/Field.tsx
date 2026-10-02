import { forwardRef, useId, useRef, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react'
import { cn } from '@/lib/cn'
import { useFitHeight } from './useFitHeight'

const control =
  'w-full rounded-md border border-line bg-page px-2.5 text-[13.5px] text-fg placeholder:text-faint transition-[border-color,box-shadow] duration-150 hover:border-line-strong focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 disabled:opacity-60'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cn(control, 'h-8', className)} {...rest} />
})

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** Grows with its content between minRows and maxRows, without jumping. */
  autoGrow?: boolean
  minRows?: number
  maxRows?: number
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, autoGrow = true, minRows = 2, maxRows = 16, value, ...rest },
  outerRef
) {
  const inner = useRef<HTMLTextAreaElement | null>(null)
  // Grows with the text and re-measures when the box is resized (a side panel dragged wider).
  useFitHeight(inner, value, autoGrow ? minRows : 0, autoGrow ? maxRows : 0)
  return (
    <textarea
      ref={(el) => {
        inner.current = el
        if (typeof outerRef === 'function') outerRef(el)
        else if (outerRef) outerRef.current = el
      }}
      rows={minRows}
      value={value}
      className={cn(control, 'resize-none py-1.5 leading-[1.55]', className)}
      {...rest}
    />
  )
})

export interface FieldProps {
  label: string
  hint?: ReactNode
  error?: string | null
  className?: string
  children: (id: string) => ReactNode
}

/** A labelled form control: <Field label="Name">{(id) => <Input id={id} />}</Field> */
export function Field({ label, hint, error, className, children }: FieldProps): React.JSX.Element {
  const id = useId()
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <label htmlFor={id} className="text-[12px] font-medium text-muted">
        {label}
      </label>
      {children(id)}
      {error ? <p className="text-[12px] text-danger">{error}</p> : hint ? <p className="text-[12px] text-faint">{hint}</p> : null}
    </div>
  )
}

/** A comma- or newline-separated list edited as text, stored as string[]. */
export function ListInput({
  value,
  onChange,
  placeholder,
  id
}: {
  value: string[]
  onChange: (v: string[]) => void
  placeholder?: string
  id?: string
}): React.JSX.Element {
  return (
    <Input
      id={id}
      defaultValue={value.join(', ')}
      placeholder={placeholder}
      onBlur={(e) =>
        onChange(
          e.target.value
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        )
      }
    />
  )
}
