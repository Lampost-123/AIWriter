// Settings › Models: finding earlier passages by meaning (story memory step 5, Adam, 2026-10-07). Before each draft
// the briefing searches the story so far for what the scene is about: by its words always, and by meaning once the
// search model is downloaded (about 133 MB, once, like the speech models). The switch turns the search model off;
// the download, its progress and Stop, and Remove are here too.
import { useEffect, useId, useState } from 'react'
import type { SearchModelStatus } from '@shared/contracts/searchModel'
import { Badge, Button, SettingsSection } from '@/components/ui'
import { Download } from '@/components/ui/icons'
import { api, onEvent } from '@/lib/api'
import { useApp } from '@/lib/store'
import { Switch } from '@/features/world/parts/Switch'

/** The search model's status, kept current by 'searchModel:status'; null until first known. */
function useSearchModel(): SearchModelStatus | null {
  const [status, setStatus] = useState<SearchModelStatus | null>(null)
  useEffect(() => {
    let live = true
    void api
      .getSearchModel()
      .then((s) => live && setStatus(s))
      .catch(() => undefined)
    const off = onEvent('searchModel:status', (s) => setStatus(s))
    return () => {
      live = false
      off()
    }
  }, [])
  return status
}

const act = async (fn: () => Promise<SearchModelStatus>, set?: (s: SearchModelStatus) => void): Promise<void> => {
  try {
    const s = await fn()
    set?.(s)
  } catch {
    /* the status event says what happened */
  }
}

export function FindByMeaningSettings(): React.JSX.Element | null {
  const on = useApp((s) => s.settings?.findByMeaning ?? true)
  const ready = useApp((s) => !!s.settings)
  const update = useApp((s) => s.updateSettings)
  const status = useSearchModel()
  const id = useId()
  if (!ready) return null
  return (
    <SettingsSection title="Finding earlier passages">
      <div className="flex max-w-md items-start gap-3 rounded-lg border border-line px-3 py-2.5">
        <Switch id={id} checked={on} onChange={(v) => void update({ findByMeaning: v })} aria-describedby={`${id}-help`} className="mt-0.5" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <label htmlFor={id} className="text-[13px] font-medium text-fg">
              Find by meaning
            </label>
            {on && status?.state === 'ready' ? <Badge tone="success">Ready</Badge> : null}
          </div>
          <p id={`${id}-help`} className="mt-0.5 text-[12.5px] leading-relaxed text-muted">
            Before each draft, earlier scenes, facts and summaries that matter here are found by their words, and with the search model also
            by what they mean (“her brother”, “the promise at the well”). The search runs on this computer.
          </p>
          {/* Reserved height, so nothing jumps as the status arrives. */}
          <div className="min-h-[28px]">{status && on ? <ModelLine status={status} /> : null}</div>
        </div>
      </div>
    </SettingsSection>
  )
}

function ModelLine({ status }: { status: SearchModelStatus }): React.JSX.Element {
  const [shown, setShown] = useState(status)
  useEffect(() => setShown(status), [status])
  const s = shown
  if (s.state === 'downloading') {
    const percent = s.progress == null ? null : Math.round(s.progress * 100)
    return (
      <div className="mt-2" aria-live="polite">
        <div className="flex items-center gap-3">
          <p className="min-w-0 flex-1 text-[12.5px] text-muted">Downloading the search model{percent == null ? '…' : ` · ${percent}%`}</p>
          <Button size="sm" variant="ghost" onClick={() => void act(() => api.stopSearchModelDownload(), setShown)}>
            Stop
          </Button>
        </div>
        <div
          className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-2"
          role="progressbar"
          aria-label="Download progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent ?? undefined}
        >
          <div className="h-full rounded-full bg-accent transition-[width] duration-200" style={{ width: `${Math.max(2, percent ?? 0)}%` }} />
        </div>
      </div>
    )
  }
  if (s.state === 'none') {
    return (
      <div className="mt-2">
        {s.problem ? <p className="mb-1.5 text-[12.5px] leading-relaxed text-danger">{s.problem}</p> : null}
        <Button size="sm" icon={<Download size={13} />} onClick={() => void act(() => api.downloadSearchModel(), setShown)}>
          {s.problem ? 'Try again' : `Download the search model (${s.sizeMb} MB)`}
        </Button>
        <p className="mt-1 text-[12px] text-faint">Until then, passages are found by their words.</p>
      </div>
    )
  }
  if (s.state === 'broken') {
    return (
      <div className="mt-2">
        <p className="text-[12.5px] leading-relaxed text-danger">{s.problem}</p>
        <Button size="sm" variant="secondary" className="mt-1.5" onClick={() => void act(() => api.removeSearchModel(), setShown)}>
          Remove the search model
        </Button>
      </div>
    )
  }
  if (s.state === 'starting') return <p className="mt-2 text-[12.5px] text-muted">Getting the search model ready…</p>
  const reading = s.indexed && s.indexed.total > 0 && s.indexed.done < s.indexed.total
  return (
    <div className="mt-2 flex items-center gap-3">
      <p className="min-w-0 flex-1 text-[12.5px] text-muted">
        {reading
          ? `Reading this world’s scenes for meaning: ${s.indexed!.done.toLocaleString('en-GB')} of ${s.indexed!.total.toLocaleString('en-GB')} passages.`
          : `Search model downloaded (${s.sizeMb} MB).`}
      </p>
      <Button size="sm" variant="ghost" onClick={() => void act(() => api.removeSearchModel(), setShown)}>
        Remove
      </Button>
    </div>
  )
}
