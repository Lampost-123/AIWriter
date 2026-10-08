import { useId, type ReactNode } from 'react'

/**
 * A scene card part a chapter card carries (point of view, characters present, location, when, mood, length, notes),
 * with its label. While it follows the chapter card, a small "From chapter" tag shows by the label (a screen reader
 * hears it as part of the label); once it is the scene's own and the chapter card has one, "Use chapter's" sets it
 * back to following the chapter.
 */
export function CarryRow({
  label,
  follows,
  canUse,
  onUse,
  hint,
  children
}: {
  label: string
  /** The part follows the chapter card. */
  follows: boolean
  /** The chapter card has this part, and the scene has its own: "Use chapter's" is offered. */
  canUse: boolean
  onUse: () => void
  hint?: ReactNode
  /** The control, given the label's id for it and the hint's id. */
  children: (id: string, hintId: string | undefined) => ReactNode
}): React.JSX.Element {
  const id = useId()
  const hintId = useId()
  return (
    <div className="flex flex-col gap-1" data-carry={label}>
      <div className="flex min-h-5 items-center justify-between gap-2">
        <label htmlFor={id} className="text-[12px] font-medium text-muted">
          {label}
          {follows ? <span className="sr-only"> (from the chapter card)</span> : null}
        </label>
        {follows ? (
          <span
            aria-hidden
            title="This follows the chapter card. Change it here to give this scene its own."
            className="shrink-0 animate-fade-in rounded-full bg-accent-soft px-1.5 py-px text-[11px] font-medium leading-4 text-accent"
          >
            From chapter
          </span>
        ) : canUse ? (
          <button
            type="button"
            onClick={onUse}
            aria-label={`Use the chapter's ${label.toLowerCase()}`}
            title="Follow the chapter card for this again"
            className="shrink-0 rounded text-[11.5px] font-medium text-accent outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            Use chapter’s
          </button>
        ) : null}
      </div>
      {children(id, hint ? hintId : undefined)}
      {hint ? (
        <p id={hintId} className="text-[12px] text-faint">
          {hint}
        </p>
      ) : null}
    </div>
  )
}
