// The outcome line under a chat answer (chat-truth R1): what came of it, from what the app recorded (shared/askOutcome),
// never from the AI's words. The state words in amber (waiting, started) or green (applied); red only when a change
// couldn't go in. Its space is kept while the answer streams, so nothing under it moves when it appears.
import type { Outcome } from '@shared/askOutcome'
import { cn } from '@/lib/cn'

const TONE = { ai: 'font-medium text-ai', success: 'font-medium text-success', danger: 'font-medium text-danger' } as const

export function OutcomeLine({ outcome, streaming }: { outcome: Outcome; streaming: boolean }): React.JSX.Element | null {
  if (!outcome.words) return streaming ? <div aria-hidden className="mt-2 h-[18px]" /> : null
  return (
    <p role="status" data-outcome={outcome.state} className="mt-2 min-h-[18px] animate-fade-in px-1 font-sans text-[12.5px] leading-[18px] text-muted">
      {outcome.parts.map((p, i) => (
        <span key={i} className={cn(p.tone && TONE[p.tone])}>
          {p.text}
        </span>
      ))}
    </p>
  )
}
