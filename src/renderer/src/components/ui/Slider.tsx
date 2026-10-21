import { useEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { Field } from './Field'
import { DISABLED } from './controls'
import './slider.css'

/** How far along the track a value sits, as a percentage (0 to 100), for the filled part of the track. */
export function sliderFill(value: number, min: number, max: number): number {
  if (!(max > min) || !Number.isFinite(value)) return 0
  return Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100))
}

export interface SliderProps {
  /** The value as saved. While the slider is held, it shows its own value instead. */
  value: number
  min: number
  max: number
  step: number
  /** Once, when the slider is let go (or a key moved it), with the value it settled on. Not called if nothing changed. */
  onCommit: (value: number) => void
  /** At every step while it moves, for a live preview. */
  onLive?: (value: number) => void
  /** A visible label: shown as "Label: value" (with `format`) and naming the slider. */
  label?: string
  format?: (value: number) => string
  hint?: ReactNode
  /** Names the slider when it has no visible label. */
  'aria-label'?: string
  /** What a screen reader hears for a value ("75%"); `format` otherwise. */
  valueText?: (value: number) => string
  /** Words at the ends of the track ("Quieter" / "Louder"). */
  before?: ReactNode
  after?: ReactNode
  disabled?: boolean
  /** Takes the keyboard as soon as it shows (a slider opened from a menu). */
  autoFocus?: boolean
  /** Keys on the slider itself, such as Enter to finish or Esc to put it back. */
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>
  className?: string
}

/**
 * The design system's slider. It moves with the pointer at once and shows its value live; the change is saved
 * once, when it is let go, not at every step (Settings › Appearance wrote the settings file 35 times for one drag).
 */
export function Slider({
  value,
  min,
  max,
  step,
  onCommit,
  onLive,
  label,
  format = String,
  hint,
  'aria-label': ariaLabel,
  valueText,
  before,
  after,
  disabled,
  autoFocus,
  onKeyDown,
  className
}: SliderProps): React.JSX.Element {
  const [live, setLive] = useState(value)
  const held = useRef(false)
  const committed = useRef(value)
  const input = useRef<HTMLInputElement>(null)
  // A saved value arriving (from here or elsewhere) shows, unless the slider is being held: it never jumps back mid-drag.
  useEffect(() => {
    committed.current = value
    if (!held.current) setLive(value)
  }, [value])

  const commit = (v: number): void => {
    held.current = false
    if (!Number.isFinite(v) || v === committed.current) return
    committed.current = v
    onCommit(v)
  }
  // The browser's own "change" comes once a drag ends, and at once for each key press: exactly when to save.
  const commitRef = useRef(commit)
  commitRef.current = commit
  useEffect(() => {
    const el = input.current
    if (!el) return
    const onChange = (): void => commitRef.current(Number(el.value))
    el.addEventListener('change', onChange)
    return () => el.removeEventListener('change', onChange)
  }, [])

  const range = (id?: string): React.JSX.Element => (
    <input
      ref={input}
      id={id}
      type="range"
      min={min}
      max={max}
      step={step}
      value={live}
      disabled={disabled}
      autoFocus={autoFocus}
      onKeyDown={onKeyDown}
      aria-label={label ? undefined : ariaLabel}
      aria-valuetext={valueText ? valueText(live) : label ? format(live) : undefined}
      onPointerDown={() => {
        held.current = true
      }}
      onChange={(e) => {
        const v = Number(e.target.value)
        setLive(v)
        onLive?.(v)
      }}
      onPointerUp={(e) => commit(Number(e.currentTarget.value))}
      onPointerCancel={(e) => commit(Number(e.currentTarget.value))}
      onBlur={(e) => commit(Number(e.currentTarget.value))}
      className={cn('ui-slider min-w-0 flex-1', DISABLED)}
      style={{ '--fill': `${sliderFill(live, min, max)}%` } as React.CSSProperties}
    />
  )
  const track = (id?: string): React.JSX.Element =>
    before || after ? (
      <div className={cn('flex items-center gap-3', !label && className)}>
        {before ? (
          <span aria-hidden className="shrink-0 text-[12px] text-faint">
            {before}
          </span>
        ) : null}
        {range(id)}
        {after ? (
          <span aria-hidden className="shrink-0 text-[12px] text-faint">
            {after}
          </span>
        ) : null}
      </div>
    ) : (
      <div className={cn('flex items-center', !label && className)}>{range(id)}</div>
    )
  if (!label) return track()
  return (
    <Field label={`${label}: ${format(live)}`} hint={hint} className={className}>
      {(id) => track(id)}
    </Field>
  )
}
