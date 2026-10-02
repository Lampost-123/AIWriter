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

const pillButton = 'h-7 rounded-full hover:bg-accent/10'

/**
 * A small note in the top bar's free middle, shown only when an update has downloaded. It sits in
 * space that is always there and only fades in and out, so nothing on the page ever moves for it.
 * It never restarts the app by itself.
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

  if (!ready) return null
  const sentence = `A new version of AI Write is ready (${ready.version}).`

  return (
    <div
      role="status"
      aria-hidden={!show}
      inert={!show}
      className={cn(
        'flex h-8 min-w-0 max-w-full items-center gap-0.5 rounded-full border border-accent/25 bg-accent-soft pl-3 pr-0.5 text-[12.5px]',
        'transition-[opacity,visibility] duration-200 ease-out',
        show ? 'opacity-100 animate-fade-in' : 'invisible opacity-0'
      )}
    >
      <Sparkles size={14} className="shrink-0 text-accent" aria-hidden />
      <span className="ml-1.5 mr-1 min-w-0 truncate font-medium text-fg" title={sentence}>
        <span className="hidden xl:inline">{sentence}</span>
        <span className="xl:hidden">Update ready</span>
      </span>
      {ready.notes ? (
        // On a narrow window the notes stay on Settings › About and updates.
        <span className="hidden lg:contents">
          <P.Root>
            <P.Trigger asChild>
              <Button size="sm" variant="ghost" className={pillButton}>
                What's new
              </Button>
            </P.Trigger>
            <P.Portal>
              <P.Content
                align="center"
                sideOffset={8}
                className="z-50 w-[360px] rounded-lg border border-line bg-surface p-3.5 shadow-pop data-[state=open]:animate-pop-in"
              >
                <p className="mb-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-faint">What's new in {ready.version}</p>
                <p className="max-h-64 overflow-auto whitespace-pre-line text-[13px] leading-relaxed text-fg">{ready.notes}</p>
              </P.Content>
            </P.Portal>
          </P.Root>
        </span>
      ) : null}
      <Button size="sm" variant="ghost" className={pillButton} onClick={dismiss}>
        Later
      </Button>
      <Button size="sm" variant="primary" className="h-7 rounded-full" loading={restarting} onClick={() => void restart()}>
        Restart to update
      </Button>
    </div>
  )
}
