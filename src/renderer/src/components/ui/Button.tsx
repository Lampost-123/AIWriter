import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { Spinner } from './Spinner'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'ai'
type Size = 'sm' | 'md' | 'lg'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  icon?: ReactNode
  loading?: boolean
}

const variants: Record<Variant, string> = {
  primary: 'bg-accent text-accent-fg hover:bg-accent-hover shadow-sm',
  secondary: 'bg-surface text-fg border border-line hover:bg-surface-2 hover:border-line-strong',
  ghost: 'text-muted hover:text-fg hover:bg-surface-2',
  danger: 'bg-surface text-danger border border-line hover:bg-danger-soft hover:border-danger/40',
  ai: 'bg-ai text-ai-fg hover:brightness-110 shadow-sm'
}

const newLook: Record<Variant, string> = {
  primary:
    'look-new:bg-[linear-gradient(180deg,color-mix(in_srgb,var(--accent)_88%,white),var(--accent))] look-new:shadow-[inset_0_1px_0_rgb(255_255_255/0.2),var(--elev-2)] look-new:hover:brightness-[1.06]',
  secondary: 'look-new:bg-raise look-new:shadow-e1 look-new:hover:bg-raise look-new:hover:border-line-strong',
  ghost: '',
  danger: 'look-new:bg-raise look-new:shadow-e1',
  ai: 'look-new:bg-[linear-gradient(180deg,color-mix(in_srgb,var(--ai)_88%,white),var(--ai))] look-new:shadow-[inset_0_1px_0_rgb(255_255_255/0.2),var(--elev-2)]'
}

const sizes: Record<Size, string> = {
  sm: 'h-7 px-2.5 text-[13px] gap-1.5 rounded-md',
  md: 'h-8 px-3 text-[13.5px] gap-2 rounded-md',
  lg: 'h-10 px-4 text-[14.5px] gap-2 rounded-lg'
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon, loading, className, children, disabled, ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap font-medium transition-[background-color,border-color,color,filter] duration-150',
        'disabled:pointer-events-none disabled:opacity-50',
        // The New look: buttons press in, a little rounder, the filled ones raised.
        'look-new:rounded-[9px] look-new:transition-[background-color,border-color,color,filter,transform,box-shadow] look-new:duration-(--dur-quick) look-new:active:scale-[0.97]',
        variants[variant],
        newLook[variant],
        sizes[size],
        className
      )}
      {...rest}
    >
      {loading ? <Spinner size={14} /> : icon}
      {children}
    </button>
  )
})

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Required: used as the accessible name and tooltip text. */
  label: string
  size?: 'sm' | 'md'
  active?: boolean
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, size = 'md', active, className, children, ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-md text-muted transition-colors duration-150 hover:bg-surface-2 hover:text-fg',
        'disabled:pointer-events-none disabled:opacity-40',
        'look-new:rounded-[9px] look-new:transition-[background-color,color,transform] look-new:duration-(--dur-quick) look-new:active:scale-[0.92]',
        active && 'bg-surface-2 text-fg look-new:bg-raise look-new:text-accent look-new:shadow-e1',
        size === 'sm' ? 'h-6 w-6' : 'h-8 w-8',
        className
      )}
      {...rest}
    >
      {children}
    </button>
  )
})
