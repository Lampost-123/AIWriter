// The AI at work on a plan, in the AI's own language (UI overhaul, "the AI planning pages"): the small lamp (its flame
// flickering, sparks rising) with what it is doing in amber, and the lamp line, a thin amber line that the light runs
// along. In the results, before the first card has come, the places where the cards will lie wait as faint outlines
// with the lamp's light passing slowly over them. No spinner. Still with less motion.
import { cn } from '@/lib/cn'
import { LampMotif } from './PlanArt'

/** "Suggesting an outline…" with the lamp: the desk's WritingStatus (the same role and words). */
export function LampStatus({ text, title, className, size = 26 }: { text: string; title?: string; className?: string; size?: number }): React.JSX.Element {
  return (
    <span role="status" title={title} className={cn('plan-status', className)} data-plan-thinking>
      <LampMotif size={size} />
      <span className="plan-status-words">
        <span className="plan-status-t">{text}</span>
        <span className="plan-lampline" aria-hidden />
      </span>
    </span>
  )
}

/** Where the cards will lie, waiting for the first: faint outlines, the lamp's light passing over them. */
export function WaitingCards({ count = 3, label, className }: { count?: number; label?: string; className?: string }): React.JSX.Element {
  return (
    <div className={cn('plan-waiting', className)} aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <span key={i} className="plan-waiting-card" style={{ '--i': i } as React.CSSProperties}>
          <i />
          <i />
          <i />
        </span>
      ))}
      {label ? <span className="plan-waiting-l">{label}</span> : null}
    </div>
  )
}
