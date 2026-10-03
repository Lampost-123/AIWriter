import { ChevronRight } from '@/components/ui/icons'
import { useId, useMemo, useRef, useState } from 'react'
import { FIELD_GROUPS } from '@shared/fields'
import type { Entry, FactVersion, ID } from '@shared/types'
import { Button, toast, useToasts } from '@/components/ui'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { useApp } from '@/lib/store'
import { entryReplaced } from '../entryDrafts'
import { earlierVersions, entryDiff, isEntryData, versionLabel, whenInSentence, whenLabel, type EntryVersion } from '../historyLogic'
import { upperFirst } from '../memoryLogic'
import { QuietError } from './QuietError'
import { useEntryData } from './useEntryData'

/** Shown at first; "Show more" adds this many again. */
const PAGE = 20

/** The toast offering to undo the last "Bring this back", while it shows. */
let restoreToast: number | null = null

/** The newest version of the entry itself, as it is saved now. */
async function latestVersion(entryId: ID): Promise<FactVersion | undefined> {
  const all = await api.listEntryHistory(entryId)
  return all.filter((v) => v.factKind === 'entry' && v.factId === entryId).sort((a, b) => b.version - a.version)[0]
}

/**
 * Earlier versions of the entry (its memory history): who changed it and when, compared side by
 * side with the page as it is now, and brought back in one click (with Undo). Loads only while open.
 */
export function HistorySection({
  now,
  placeName,
  beforeRestore
}: {
  /** The page as it is now, including edits not saved yet. */
  now: Entry
  placeName: (id: ID) => string
  /** Saves anything still waiting, so what is brought back can be undone to exactly what was on screen. */
  beforeRestore: () => Promise<void>
}): React.JSX.Element {
  const entryId = now.id
  const history = useEntryData(() => api.listEntryHistory(entryId), `history:${entryId}`)
  // Which scene each memory update read, to say "Updated from Book 1, Ch 3, Sc 2". Optional.
  const log = useEntryData(() => api.listMemoryLog({ entryId, limit: 500 }), `log:${entryId}`)
  const [shown, setShown] = useState(PAGE)
  const [openId, setOpenId] = useState<ID | null>(null)
  const [busy, setBusy] = useState(false)

  const versions = useMemo(() => (history.data ? earlierVersions(history.data, entryId) : null), [history.data, entryId])
  const whereOfRun = useMemo(() => {
    const m = new Map<ID, string>()
    for (const item of log.data ?? []) if (item.runId && item.where && !m.has(item.runId)) m.set(item.runId, item.where)
    return m
  }, [log.data])

  if (history.error && !history.data) return <QuietError what="earlier versions" message={history.error} onRetry={history.reload} />
  if (!versions) return <div className="h-5" aria-hidden />
  if (!versions.length) {
    return (
      <p className="text-[13px] leading-relaxed text-muted">
        Earlier versions of this page are kept here as it changes, whether you change it or the story does. You can compare any of them with
        how it is now, and bring one back.
      </p>
    )
  }

  const name = now.name.trim()
  const page = name ? `${name}'s page` : 'this page'
  const restore = async (v: EntryVersion): Promise<boolean> => {
    if (busy) return false
    setBusy(true)
    try {
      await beforeRestore()
      const before = await latestVersion(entryId)
      const restored = await api.restoreEntryVersion(entryId, v.id)
      entryReplaced(restored)
      useApp.getState().bumpEntries()
      setOpenId(null)
      // Only the newest one offers Undo, so an older Undo can't jump back past what came since.
      if (restoreToast !== null) useToasts.getState().dismiss(restoreToast)
      const id = toast(`Brought back ${page} as it was ${whenInSentence(v.createdAt)}.`, {
        action: before
          ? {
              label: 'Undo',
              run: () =>
                void beforeRestore()
                  .then(() => api.restoreEntryVersion(entryId, before.id))
                  .then((e) => {
                    entryReplaced(e)
                    useApp.getState().bumpEntries()
                    toast(`Undone. ${upperFirst(page)} is back to how it was.`)
                  })
                  .catch((err: Error) => void toast(`Couldn't undo that. ${err.message}`, { tone: 'danger' }))
            }
          : undefined
      })
      restoreToast = id
      return true
    } catch (err) {
      toast(`Couldn't bring that back. ${(err as Error).message}`, { tone: 'danger' })
      return false
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-[12.5px] leading-relaxed text-muted">
        Every change to this page is kept. Compare an earlier one with now, and bring it back if you like.
      </p>
      <ol className="flex flex-col rounded-lg border border-line bg-surface">
        {versions.slice(0, shown).map((v) => (
          <VersionRow
            key={v.id}
            version={v}
            label={versionLabel(v, v.runId ? (whereOfRun.get(v.runId) ?? null) : null)}
            now={now}
            placeName={placeName}
            open={openId === v.id}
            busy={busy}
            onToggle={() => setOpenId((id) => (id === v.id ? null : v.id))}
            onRestore={() => restore(v)}
          />
        ))}
      </ol>
      {versions.length > shown ? (
        <Button variant="ghost" size="sm" className="self-start" onClick={() => setShown((n) => n + PAGE)}>
          Show {Math.min(PAGE, versions.length - shown)} more
        </Button>
      ) : null}
    </div>
  )
}

function VersionRow({
  version: v,
  label,
  now,
  placeName,
  open,
  busy,
  onToggle,
  onRestore
}: {
  version: EntryVersion
  label: string
  now: Entry
  placeName: (id: ID) => string
  open: boolean
  busy: boolean
  onToggle: () => void
  onRestore: () => Promise<boolean>
}): React.JSX.Element {
  const panelId = useId()
  const toggleRef = useRef<HTMLButtonElement>(null)
  const then = isEntryData(v.data) ? v.data : null
  const rows = useMemo(
    () => (open && then ? entryDiff(then, now, FIELD_GROUPS[now.kind] ?? [], placeName) : []),
    [open, then, now, placeName]
  )
  // The panel with "Bring this back" closes once it's done: keep the keyboard on this row rather than lose it.
  const restore = (): void => void onRestore().then((done) => done && toggleRef.current?.focus())
  return (
    <li className="border-t border-line first:border-t-0">
      <button
        ref={toggleRef}
        type="button"
        aria-expanded={then ? open : undefined}
        aria-controls={then ? panelId : undefined}
        disabled={!then}
        onClick={onToggle}
        className="group flex min-h-10 w-full items-center gap-2 rounded-lg px-3 py-2 text-left disabled:cursor-default"
      >
        {then ? (
          <ChevronRight
            size={14}
            className={cn('shrink-0 text-faint transition-transform duration-150 group-hover:text-muted', open && 'rotate-90')}
          />
        ) : (
          <span className="w-3.5 shrink-0" />
        )}
        <span className="min-w-0 flex-1 truncate text-[13px] text-fg">{label}</span>
        <span className="shrink-0 text-[12px] tabular-nums text-faint">{whenLabel(v.createdAt)}</span>
      </button>
      {open && then ? (
        <div id={panelId} className="animate-fade-in px-3 pb-3">
          {rows.length ? (
            <div className="rounded-md border border-line bg-page">
              <div className="grid grid-cols-2 gap-3 border-b border-line px-3 py-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-faint">
                <span>Then</span>
                <span>Now</span>
              </div>
              <dl className="flex flex-col divide-y divide-line">
                {rows.map((r) => (
                  <div key={r.key} className="px-3 py-2">
                    <dt className="mb-1 text-[12px] font-medium text-muted">{r.label}</dt>
                    <dd className="grid grid-cols-2 gap-3 text-[13px] leading-relaxed">
                      <DiffCell text={r.then} />
                      <DiffCell text={r.now} />
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : (
            <p className="text-[12.5px] text-muted">This is the same as the page now.</p>
          )}
          <div className="mt-2.5 flex justify-end">
            <Button size="sm" loading={busy} disabled={!rows.length} onClick={restore}>
              Bring this back
            </Button>
          </div>
        </div>
      ) : null}
    </li>
  )
}

function DiffCell({ text }: { text: string }): React.JSX.Element {
  return text ? (
    <span className="min-w-0 whitespace-pre-wrap break-words text-fg">{text}</span>
  ) : (
    <span className="italic text-faint">Empty</span>
  )
}
