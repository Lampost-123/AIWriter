// The top bar while Write the whole chapter works: what it is doing ("Fixing Sc 2 “The ferry”, round 2…"), and, on a
// click, the round, what it has spent so far, the report and Stop. Nothing shows (and no room is kept) otherwise.

import * as P from '@radix-ui/react-popover'
import { useState } from 'react'
import { Button } from '@/components/ui'
import { cn } from '@/lib/cn'
import { PopoverPanel } from '@/features/generate/parts'
import { costWords, progressLine } from './chapterWriterLogic'
import { showReport, stopChapterWriter, useChapterWriter } from './chapterWriterStore'

const slotButton =
  'flex h-7 max-w-[260px] items-center gap-2 rounded-md px-2 text-[12px] outline-none transition-colors duration-150 hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-accent/40 animate-fade-in'

export function ChapterWriterStatus(): React.JSX.Element | null {
  const progress = useChapterWriter((s) => s.progress)
  const [open, setOpen] = useState(false)
  const [stopping, setStopping] = useState(false)
  if (!progress) return null
  const stop = async (): Promise<void> => {
    setStopping(true)
    try {
      await stopChapterWriter()
      setOpen(false)
    } finally {
      setStopping(false)
    }
  }
  const spent = costWords(progress.cost)
  return (
    <div className="flex min-w-0 shrink justify-end" role="status" aria-live="polite" data-testid="chapter-writer-status">
      <P.Root open={open} onOpenChange={setOpen}>
        <P.Trigger
          className={cn(slotButton, 'text-muted hover:text-fg data-[state=open]:bg-surface-2')}
          title="The AI is writing a chapter. Click to see how it is going, or stop it."
        >
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-ai animate-pulse motion-reduce:animate-none" aria-hidden />
          <span className="truncate">{progressLine(progress)}</span>
        </P.Trigger>
        <PopoverPanel className="w-[320px]">
          <h3 className="text-[13.5px] font-semibold text-fg">Writing the chapter</h3>
          <p className="mt-1 text-[12.5px] leading-relaxed text-muted">{progressLine(progress)}</p>
          <p className="mt-2 text-[12px] leading-relaxed text-faint">
            {progress.round ? `Round ${progress.round} of checks. ` : ''}It keeps going until the checks and the critic find nothing more.
            {spent ? ` Spent ${spent}.` : ''} The scenes it is working on can be read but not typed in until it finishes.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <Button size="sm" loading={stopping} onClick={() => void stop()} data-testid="chapter-writer-stop">
              Stop
            </Button>
            <button
              type="button"
              className="ml-auto rounded text-[12px] font-medium text-accent outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent/40"
              onClick={() => {
                setOpen(false)
                showReport(progress.chapterId)
              }}
            >
              The report so far
            </button>
          </div>
        </PopoverPanel>
      </P.Root>
    </div>
  )
}
