// A slim line across the top of the workspace while the sample world is open (milestone 6): says it is the sample,
// and offers the way to start Adam's own world (the first-run setup, or the New world dialog once he has worlds).

import { ArrowRight, BookOpen } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui'
import { useApp } from '@/lib/store'
import { usePalette } from '@/features/palette/paletteStore'
import { startOwnWorld, useSetup } from './setupStore'

export function SampleWorldBar(): React.JSX.Element | null {
  const worldId = useApp((s) => s.world?.id ?? null)
  const sampleId = useSetup((s) => s.sampleWorldId)
  const [busy, setBusy] = useState(false)
  if (!worldId || worldId !== sampleId) return null
  return (
    <div
      role="region"
      aria-label="Sample world"
      className="flex h-9 shrink-0 items-center gap-2.5 border-b border-line bg-surface-2 px-3 text-[12.5px]"
    >
      <BookOpen size={14} className="shrink-0 text-muted" aria-hidden />
      <p className="min-w-0 flex-1 truncate text-muted">
        <span className="font-medium text-fg">You’re exploring the sample world.</span> Read the scenes, open the codex, the timeline and
        the map, and change anything you like.
      </p>
      <Button
        size="sm"
        variant="ghost"
        className="shrink-0 text-accent hover:text-accent-hover"
        icon={<ArrowRight size={14} />}
        loading={busy}
        onClick={() => {
          setBusy(true)
          void startOwnWorld(() => usePalette.setState({ newWorld: true })).finally(() => setBusy(false))
        }}
      >
        Start my own world
      </Button>
    </div>
  )
}
