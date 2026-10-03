// A quiet line at the foot of the binder's chapters while the import catch-up builds the memory: "Reading
// chapter 3 of 24", how far it has got, and Stop; when it has paused, why, with Try again. It shows whichever
// page is open, and nothing shows otherwise. Clicking the words opens the page with its progress. Owned by
// the Manuscript import part.
import { CircleAlert } from 'lucide-react'
import { useEffect } from 'react'
import { Spinner } from '@/components/ui'
import { buildMemory, listenForCatchUp, offerMemory, stopBuildingMemory, useImport } from './importStore'
import { catchUpWords } from './importLogic'

export function ImportLine(): React.JSX.Element | null {
  const run = useImport((s) => s.catchUp.running)
  useEffect(() => listenForCatchUp(), [])
  if (!run) return null
  const paused = run.status === 'paused'
  const share = run.scenes ? Math.min(1, run.read / run.scenes) : 0
  return (
    <div
      role="status"
      aria-label="Building the memory"
      className="relative flex h-9 shrink-0 items-center gap-2 border-t border-line px-3 text-[12px] text-muted animate-fade-in"
    >
      {paused ? <CircleAlert size={13} className="shrink-0 text-muted" /> : <Spinner size={12} />}
      <button
        type="button"
        title={paused ? (run.error ?? undefined) : `Building the memory from “${run.storyTitle}”: ${run.read} of ${run.scenes} scenes read`}
        onClick={() => offerMemory(run.storyId)}
        className="min-w-0 flex-1 truncate rounded text-left outline-none hover:text-fg focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        {catchUpWords(run)}
      </button>
      {paused ? (
        <button
          type="button"
          onClick={() => void buildMemory(run.storyId)}
          className="shrink-0 rounded px-1.5 py-0.5 font-medium text-muted outline-none hover:bg-surface-2 hover:text-fg focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          Try again
        </button>
      ) : null}
      <button
        type="button"
        disabled={run.status === 'stopping'}
        aria-label="Stop building the memory"
        onClick={() => void stopBuildingMemory()}
        className="shrink-0 rounded px-1.5 py-0.5 font-medium text-muted outline-none hover:bg-surface-2 hover:text-fg focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-50"
      >
        Stop
      </button>
      {/* How far it has got, as a hairline along the top of the line. */}
      <span aria-hidden className="absolute inset-x-0 top-0 h-px bg-transparent">
        <span className="block h-full bg-accent transition-[width] duration-200" style={{ width: `${Math.round(share * 100)}%` }} />
      </span>
    </div>
  )
}
