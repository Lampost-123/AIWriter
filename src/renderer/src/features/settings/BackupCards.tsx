// Settings › Backups in the New look: the backups as cards down a timeline, grouped by day, the newest marked; each
// with a drawing of the copy kept (tinted by why it was made), its time, why and its size. Restore opens the card into
// a clear preview of what the backup holds beside the world as it is now (stories, scenes, words, entries, and each
// story's words), with Restore and Cancel; nothing is changed until Restore. The list keeps Classic's names and ways
// (one list "Backups", each row's "Restore the backup from …", Esc to cancel), so it behaves exactly the same.
import { useEffect, useRef, useState } from 'react'
import type { BackupInfo, BackupPreview, WorldCounts } from '@shared/types'
import { Archive, CircleArrowUp, Clock, DoorOpen, Hand, History, RotateCcw, type IconType } from '@/components/ui/icons'
import { Button } from '@/components/ui'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { clockTime, dayLabel, formatBackupDate, formatSize, inSentence, reasonLabel } from './backupText'

const REASONS: Record<BackupInfo['reason'], { icon: IconType; ink: string; soft: string }> = {
  launch: { icon: DoorOpen, ink: 'var(--k-place)', soft: 'var(--k-place-soft)' },
  timer: { icon: Clock, ink: 'var(--k-group)', soft: 'var(--k-group-soft)' },
  manual: { icon: Hand, ink: 'var(--accent)', soft: 'var(--accent-soft)' },
  'before-restore': { icon: History, ink: 'var(--k-event)', soft: 'var(--k-event-soft)' },
  'before-migration': { icon: CircleArrowUp, ink: 'var(--k-lore)', soft: 'var(--k-lore-soft)' }
}

export interface BackupRowProps {
  backup: BackupInfo
  /** The first of its day: the day's name shows above it. */
  day: string | null
  newest: boolean
  fresh: boolean
  confirming: boolean
  restoring: boolean
  locked: boolean
  onAsk: () => void
  onCancel: () => void
  onRestore: () => void
}

export function NewBackupRow({ backup, day, newest, fresh, confirming, restoring, locked, onAsk, onCancel, onRestore }: BackupRowProps): React.JSX.Element {
  const when = formatBackupDate(backup.createdAt)
  const r = REASONS[backup.reason] ?? { icon: Archive, ink: 'var(--muted)', soft: 'var(--surface-2)' }
  const Icon = r.icon
  const confirmRef = useRef<HTMLButtonElement>(null)
  const askRef = useRef<HTMLButtonElement>(null)
  const wasConfirming = useRef(false)
  const [preview, setPreview] = useState<BackupPreview | null | 'failed'>(null)

  useEffect(() => {
    if (confirming) confirmRef.current?.focus()
    // After Cancel or Escape, keyboard focus goes back to this row's Restore button, not the page.
    else if (wasConfirming.current && (!document.activeElement || document.activeElement === document.body)) askRef.current?.focus()
    wasConfirming.current = confirming
  }, [confirming])

  // What the backup holds, read once it is asked about.
  useEffect(() => {
    if (!confirming) return
    let live = true
    setPreview(null)
    api
      .previewBackup(backup.id)
      .then((p) => live && setPreview(p))
      .catch(() => live && setPreview('failed'))
    return () => {
      live = false
    }
  }, [confirming, backup.id])

  return (
    <li
      data-backup-id={backup.id}
      data-reason={backup.reason}
      onKeyDown={(e) => {
        if (confirming && e.key === 'Escape' && !restoring) onCancel()
      }}
      className="bk-item relative pl-9"
    >
      {day ? (
        <p aria-hidden className="bk-day">
          {day}
        </p>
      ) : null}
      <div className={cn('bk-card relative', confirming && 'is-open', fresh && 'is-fresh')}>
        {/* This backup's knot on the timeline's thread. */}
        <span aria-hidden className="bk-knot" style={{ background: r.ink }} />
        <div className="flex min-h-[64px] items-center gap-3.5 px-4 py-2.5">
          <span aria-hidden className="bk-copy" style={{ color: r.ink, background: r.soft }}>
            <Icon size={16} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-2">
              <span className="font-heading text-[17px] font-semibold tabular-nums text-fg">{clockTime(backup.createdAt)}</span>
              {newest ? <span className="bk-newest">Newest</span> : null}
            </p>
            <p className="truncate text-[12px] text-muted">
              {reasonLabel(backup.reason)}
              <span className="px-1.5 text-faint">·</span>
              <span className="tabular-nums">{formatSize(backup.sizeBytes)}</span>
            </p>
          </div>
          {confirming ? null : (
            <Button
              ref={askRef}
              size="sm"
              variant="ghost"
              icon={<RotateCcw size={13} />}
              disabled={locked}
              onClick={onAsk}
              aria-label={`Restore the backup from ${inSentence(when)}`}
            >
              Restore
            </Button>
          )}
        </div>
        {confirming ? (
          <div className="bk-preview border-t border-line px-4 pb-4 pt-3.5">
            <p className="text-[14px] font-medium text-fg">Go back to {inSentence(when)}?</p>
            <p className="mt-0.5 text-[12.5px] text-muted">Your current work is backed up first, so you can undo this.</p>
            <Compare preview={preview} />
            <div className="mt-4 flex justify-end gap-2">
              <Button size="sm" variant="ghost" disabled={restoring} onClick={onCancel}>
                Cancel
              </Button>
              <Button ref={confirmRef} size="sm" variant="primary" icon={<RotateCcw size={13} />} loading={restoring} onClick={onRestore}>
                Restore
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </li>
  )
}

const STATS: { key: keyof Omit<WorldCounts, 'storyList'>; label: string }[] = [
  { key: 'stories', label: 'Stories' },
  { key: 'scenes', label: 'Scenes' },
  { key: 'words', label: 'Words' },
  { key: 'entries', label: 'World entries' }
]

/** The backup beside the world now: four numbers each, with what would change, and each story's words. */
function Compare({ preview }: { preview: BackupPreview | null | 'failed' }): React.JSX.Element {
  if (preview === 'failed' || (preview && !preview.backup)) {
    return <p className="mt-3 text-[12.5px] text-muted">This backup couldn’t be looked inside, but it can still be restored.</p>
  }
  const then = preview?.backup ?? null
  const now = preview?.now ?? null
  return (
    <div className={cn('mt-3.5 transition-opacity duration-(--dur-base)', !then && 'opacity-0')} aria-busy={!then || undefined}>
      <div className="grid grid-cols-2 gap-2 @[560px]:grid-cols-4">
        {STATS.map((s) => {
          const a = then?.[s.key] ?? 0
          const b = now?.[s.key] ?? null
          const diff = b == null ? 0 : a - b
          return (
            <div key={s.key} className="bk-stat">
              <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-faint">{s.label}</p>
              <p className="mt-0.5 text-[20px] font-semibold leading-tight tabular-nums text-fg">{a.toLocaleString('en-US')}</p>
              <p className={cn('text-[11.5px] tabular-nums', diff === 0 ? 'text-faint' : 'text-muted')}>
                {b == null ? '' : diff === 0 ? 'Same as now' : `${Math.abs(diff).toLocaleString('en-US')} ${diff > 0 ? 'more' : 'fewer'} than now`}
              </p>
            </div>
          )
        })}
      </div>
      {then && then.storyList.length ? (
        <ul aria-label="Stories in this backup" className="mt-3 flex flex-col gap-1">
          {then.storyList.slice(0, 6).map((st, i) => {
            const nowWords = now?.storyList.find((x) => x.title === st.title)?.words ?? null
            return (
              <li key={`${st.title}:${i}`} className="flex items-baseline gap-3 text-[12.5px]">
                <span className="min-w-0 flex-1 truncate font-heading text-fg" title={st.title}>
                  {st.title}
                </span>
                <span className="shrink-0 tabular-nums text-muted">{st.words.toLocaleString('en-US')} words</span>
                <span className="w-[120px] shrink-0 text-right tabular-nums text-faint">
                  {nowWords == null ? 'Not in your world now' : nowWords === st.words ? 'Same as now' : `${nowWords.toLocaleString('en-US')} now`}
                </span>
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}

/** The days the backups belong to: the label for each one that starts a day, else null. */
export function dayStarts(backups: BackupInfo[]): (string | null)[] {
  let last = ''
  return backups.map((b) => {
    const d = dayLabel(b.createdAt)
    if (d === last) return null
    last = d
    return d
  })
}
