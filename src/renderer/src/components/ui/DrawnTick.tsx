// The New look's tick that draws itself (Done, the save tick): a stroke that runs from start to end when `draw`
// turns on, in about a third of a second (styles.css, .drawn-tick). Less motion shows it drawn at once.
import { cn } from '@/lib/cn'

export function DrawnTick({ size = 14, draw = false, className }: { size?: number; draw?: boolean; className?: string }): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={2.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={cn('drawn-tick shrink-0', draw && 'drawn-tick-draw', className)}
    >
      <path d="M5 12.5l4.5 4.5L19 7.5" pathLength={1} />
    </svg>
  )
}
