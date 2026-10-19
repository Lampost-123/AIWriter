// "Fill in the whole story" where Adam looks after the memory (the What changed page, in the New look only: its panels,
// and on the desk the ledger's side, under how the memory is doing): what it does and a button that asks first (StoryFillDialog.tsx), and while it runs,
// how far it has got with Stop. The story is the one open now. Nothing on the page moves when it starts or ends: the
// card keeps its lines, only their words change.

import { useState } from 'react'
import { Button, toast } from '@/components/ui'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { plainReason } from '@/lib/reason'
import { useApp } from '@/lib/store'
import { fillProgress, openStoryFill } from './storyFill'

export function StoryFillCard({ desk = false, className }: { desk?: boolean; className?: string }): React.JSX.Element | null {
  const story = useApp((s) => s.stories.find((x) => x.id === s.storyId) ?? null)
  const filling = useApp((s) => s.memoryStatus?.filling ?? null)
  const [stopping, setStopping] = useState(false)
  if (!story) return null

  const stop = async (): Promise<void> => {
    setStopping(true)
    try {
      await api.stopStoryFill()
      toast('Stopped filling in the story. What was filled in stays.')
    } catch (e) {
      toast(plainReason(e))
    } finally {
      setStopping(false)
    }
  }

  const title = story.title.trim() || 'Untitled story'
  const other = filling && filling.storyId !== story.id ? filling.title.trim() || 'another story' : null
  const percent = filling && filling.total ? Math.round((filling.done / filling.total) * 100) : 0
  return (
    <section
      aria-label="Fill in the whole story"
      data-testid="story-fill"
      className={cn(desk ? 'lg-fill' : 'rounded-xl border border-line bg-surface px-4 py-3.5', className)}
    >
      <h2 className="text-[13px] font-semibold text-fg">Fill in the whole story</h2>
      {filling ? (
        <>
          <p className="mt-1 text-[12.5px] leading-relaxed text-muted" role="status">
            <span className="font-medium text-fg">
              {other ? `Filling in “${other}”: ` : ''}
              {fillProgress(filling)}
            </span>{' '}
            Keep writing meanwhile; if you stop it, what is filled in stays.
          </p>
          <div className="mt-2.5 flex items-center gap-3">
            <Button size="sm" loading={stopping} onClick={() => void stop()}>
              Stop
            </Button>
            <div
              className="h-1.5 min-w-0 max-w-[360px] flex-1 overflow-hidden rounded-full bg-surface-2"
              role="progressbar"
              aria-label="How far filling in the story has got"
              aria-valuemin={0}
              aria-valuemax={filling.total}
              aria-valuenow={filling.done}
            >
              <div
                className="h-full rounded-full bg-accent transition-[width] duration-200"
                style={{ width: `${Math.max(3, percent)}%` }}
              />
            </div>
          </div>
        </>
      ) : (
        <>
          <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
            The memory keeps track of what people wear and carry, any injuries, and where everyone ends up in the latest chapters. Do it for
            every scene of “{title}” too.
          </p>
          <div className="mt-2.5 flex items-center gap-2">
            <Button size="sm" onClick={() => openStoryFill(story.id, story.title)}>
              Fill in the whole story…
            </Button>
          </div>
        </>
      )}
    </section>
  )
}
