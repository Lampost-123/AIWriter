// A quiet line at the foot of the binder's chapters while a check runs: what is being checked, how far
// it has got, and Stop. Clicking the words opens the story's Consistency page. Nothing shows otherwise.
import { Spinner } from '@/components/ui'
import { openConsistency, stopCheck, useChecks, type CheckRun } from './checkStore'

/**
 * "Checking Ch 3, Sc 2 · 14 of 40" (`short`: without the scene's title), "Checking Ch 3, Sc 2" for one
 * scene, "Getting ready to check Ch 3…" before the first scene starts.
 */
export function runWords(run: CheckRun, short = false): string {
  const what = run.what || 'it'
  if (run.stopping) return `Stopping the check of ${what}…`
  if (run.total === null || run.done === null) return `Getting ready to check ${what}…`
  const current = run.current ? (short ? run.current.split(':')[0] : run.current) : what
  if (run.target.scope === 'scene' || run.total <= 1) return `Checking ${current}`
  return `Checking ${current} · ${Math.min(run.done + 1, run.total)} of ${run.total}`
}

export function CheckLine(): React.JSX.Element | null {
  const run = useChecks((s) => s.run)
  if (!run) return null
  return (
    <div role="status" className="flex h-9 shrink-0 items-center gap-2 border-t border-line px-3 text-[12px] text-muted animate-fade-in">
      <Spinner size={12} />
      <button
        type="button"
        title="Open this story’s consistency page"
        onClick={() => openConsistency(run.storyId)}
        className="min-w-0 flex-1 truncate rounded text-left outline-none hover:text-fg focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        {runWords(run, true)}
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
