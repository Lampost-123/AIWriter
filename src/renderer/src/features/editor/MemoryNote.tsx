// "Memory not updated" beside the scene's title, when the memory couldn't read this scene's latest
// text. It says why in plain words and offers a quiet Try again; the memory also tries again by
// itself (on the next change, on leaving the scene, and when the app starts).
import * as P from '@radix-ui/react-popover'
import { CircleAlert } from 'lucide-react'
import { useState } from 'react'
import type { ID } from '@shared/types'
import { Button, toast } from '@/components/ui'
import { api } from '@/lib/api'
import { useApp } from '@/lib/store'
import { PopoverPanel } from '@/features/generate/parts'
import { pointsToSettings } from '@/features/memory/logic'

const FALLBACK = "The memory couldn't read this scene's latest changes. It tries again by itself, or you can try now."

export function MemoryNote({ sceneId }: { sceneId: ID }): React.JSX.Element {
  const navigate = useApp((s) => s.navigate)
  const keeperError = useApp((s) => s.memoryStatus?.error ?? null)
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // The reason is in the scene's latest "Memory not updated" line in What changed.
  const loadReason = (): void => {
    api
      .listMemoryLog({ sceneId, limit: 20 })
      .then((items) => {
        const failed = items.find((i) => i.action === 'failed' && !i.undone)
        setReason(failed ? failed.text : null)
      })
      .catch(() => setReason(null))
  }

  const tryAgain = async (): Promise<void> => {
    setBusy(true)
    try {
      await api.updateMemoryNow(sceneId)
      setOpen(false)
      toast('Trying again. The memory is reading this scene.')
    } catch (e) {
      toast((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const message = reason ?? keeperError ?? FALLBACK
  return (
    <P.Root
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (o) loadReason()
      }}
    >
      <P.Trigger
        title="Memory not updated for this scene. Click to see why."
        className="ml-1 flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 text-[12px] text-muted outline-none transition-colors duration-150 hover:bg-surface-2 hover:text-fg focus-visible:ring-2 focus-visible:ring-accent/40 data-[state=open]:bg-surface-2 animate-fade-in"
      >
        <CircleAlert size={13} className="shrink-0 text-ai" aria-hidden />
        <span className="hidden whitespace-nowrap @min-[600px]:inline">Memory not updated</span>
        <span className="sr-only @min-[600px]:hidden">Memory not updated</span>
      </P.Trigger>
      <PopoverPanel className="w-[320px]" align="start">
        <h3 className="text-[13.5px] font-semibold text-fg">Memory not updated</h3>
        <p className="mt-1 select-text text-[12.5px] leading-relaxed text-muted">{message}</p>
        <p className="mt-2 text-[12px] leading-relaxed text-faint">
          Your writing is safe. Until this works, the AI knows this scene as it was last read.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {pointsToSettings(message) ? (
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                setOpen(false)
                navigate({ kind: 'settings', tab: 'models' })
              }}
            >
              Open Settings › Models
            </Button>
          ) : null}
          <Button size="sm" loading={busy} onClick={() => void tryAgain()}>
            Try again
          </Button>
        </div>
      </PopoverPanel>
    </P.Root>
  )
}
