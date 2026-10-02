import * as P from '@radix-ui/react-popover'
import { Sparkles } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { UpdateStatus } from '@shared/types'
import { Button, toast } from '@/components/ui'
import { api, onEvent } from '@/lib/api'
import { flushAll } from '@/lib/flush'
import { cn } from '@/lib/cn'

/** The version Adam said "Later" to, remembered for this run of the app. */
let laterFor: string | null = null

/**
 * A slim bar under the top bar, shown only when an update has downloaded. It opens and closes
 * smoothly, and never restarts the app by itself.
 */
export function UpdateBanner(): React.JSX.Element | null {
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  const [later, setLater] = useState(laterFor)
  const [restarting, setRestarting] = useState(false)

  useEffect(() => {
    let alive = true
    void api
      .getUpdateStatus()
      .then((s) => alive && setStatus(s))
      .catch(() => undefined)
    const off = onEvent('update:status', setStatus)
    return () => {
      alive = false
      off()
    }
  }, [])

  const ready = status?.state === 'ready' ? status : null
  const show = !!ready && later !== ready.version

  const restart = async (): Promise<void> => {
    setRestarting(true)
    try {
      await flushAll()
      await api.installUpdate()
    } catch (e) {
      toast((e as Error).message, { tone: 'danger' })
      setRestarting(false)
    }
  }

  const dismiss = (): void => {
    laterFor = ready?.version ?? null
    setLater(laterFor)
  }

  const firstLine = ready?.notes.split('\n')[0]?.replace(/^•\s*/, '') ?? ''

  return (
    <div
      className={cn('grid shrink-0 transition-[grid-template-rows] duration-200 ease-out', show ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]')}
      aria-hidden={!show}
      inert={!show}
    >
      {/* visibility flips only after the collapse has finished, so it closes smoothly. */}
      <div className={cn('min-h-0 overflow-hidden transition-[visibility] duration-200', !show && 'invisible')}>
        <div role="status" className="flex h-10 items-center gap-3 border-b border-line bg-accent-soft px-4 text-[13px]">
          <Sparkles size={15} className="shrink-0 text-accent" />
          <p className="flex min-w-0 flex-1 items-baseline gap-2">
            <span className="shrink-0 font-medium text-fg">A new version of AI Write is ready{ready ? ` (${ready.version})` : ''}.</span>
            {firstLine ? <span className="truncate text-muted">{firstLine}</span> : null}
          </p>
          {ready?.notes ? (
            <P.Root>
              <P.Trigger asChild>
                <Button size="sm" variant="ghost">
                  What's new
                </Button>
              </P.Trigger>
              <P.Portal>
                <P.Content
                  align="end"
                  sideOffset={6}
                  className="z-50 w-[360px] rounded-lg border border-line bg-surface p-3.5 shadow-pop data-[state=open]:animate-pop-in"
                >
                  <p className="mb-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-faint">What's new in {ready.version}</p>
                  <p className="max-h-64 overflow-auto whitespace-pre-line text-[13px] leading-relaxed text-fg">{ready.notes}</p>
                </P.Content>
              </P.Portal>
            </P.Root>
          ) : null}
          <Button size="sm" variant="ghost" onClick={dismiss}>
            Later
          </Button>
          <Button size="sm" variant="primary" loading={restarting} onClick={() => void restart()}>
            Restart to update
          </Button>
        </div>
      </div>
    </div>
  )
}
