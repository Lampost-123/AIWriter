// A quiet line at the foot of the binder's chapters while a check runs: what is being checked, how far
// it has got, and Stop. Clicking the words opens the story's Consistency page. Nothing shows otherwise.
import { Spinner } from '@/components/ui'
import { openConsistency, stopCheck, useChecks, useRunWords } from './checkStore'

export function CheckLine(): React.JSX.Element | null {
  const run = useChecks((s) => s.run)
  // What it is doing in plain words (runsLogic.ts): waiting its turn or for the memory, or which scene it checks.
  const words = useRunWords(run, true)
  if (!run) return null
  return (
    <div role="status" aria-label="Check running" className="flex h-9 shrink-0 items-center gap-2 border-t border-line px-3 text-[12px] text-muted animate-fade-in">
      <Spinner size={12} />
      <button
        type="button"
        title="Open this story’s consistency page"
        onClick={() => openConsistency(run.storyId)}
        className="min-w-0 flex-1 truncate rounded text-left outline-none hover:text-fg focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        {words}
      </button>
      <button
        type="button"
        disabled={run.stopping}
        aria-label="Stop the check"
        onClick={() => void stopCheck()}
        className="shrink-0 rounded px-1.5 py-0.5 font-medium text-muted outline-none hover:bg-surface-2 hover:text-fg focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-50"
      >
        Stop
      </button>
    </div>
  )
}
