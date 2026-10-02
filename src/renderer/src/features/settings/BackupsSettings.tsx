import { Archive, Clock, DoorOpen, Folder, FolderOpen, Hand, History, RotateCcw, CircleArrowUp, CloudUpload } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { BackupFolderStatus, BackupInfo } from '@shared/types'
import { Button, Card, EmptyState, Notice, SectionTitle, toast } from '@/components/ui'
import { api, onEvent } from '@/lib/api'
import { flushAll } from '@/lib/flush'
import { useApp } from '@/lib/store'
import { cn } from '@/lib/cn'
import { formatBackupDate, formatSize, reasonLabel, timeAgo } from './backupText'

const REASON_ICONS: Record<BackupInfo['reason'], ReactNode> = {
  launch: <DoorOpen size={15} />,
  timer: <Clock size={15} />,
  manual: <Hand size={15} />,
  'before-restore': <History size={15} />,
  'before-migration': <CircleArrowUp size={15} />
}

const ROW_H = 'h-[56px]'

/** True once `on` has stayed true for `ms`, so quick loads never flash a placeholder. */
function useDelayed(on: boolean, ms = 200): boolean {
  const [late, setLate] = useState(false)
  useEffect(() => {
    if (!on) {
      setLate(false)
      return
    }
    const t = setTimeout(() => setLate(true), ms)
    return () => clearTimeout(t)
  }, [on, ms])
  return late
}

/** Reloads everything after the world's database was swapped for a backup. */
async function reloadAfterRestore(): Promise<void> {
  const before = useApp.getState().outlineRev
  await useApp.getState().init()
  // init() starts the outline count again from 0, so a plain bump could land back on the old
  // value and views watching it would never reload. Move it strictly past where it was.
  useApp.setState((s) => ({ outlineRev: Math.max(s.outlineRev, before) + 1 }))
  useApp.getState().bumpEntries()
}

async function restore(id: string, when: string): Promise<void> {
  await flushAll()
  await api.restoreBackup(id)
  // The restore has happened: from here on nothing may turn it into an error.
  const safety = await api
    .listBackups()
    .then((list) => list.find((b) => b.reason === 'before-restore'))
    .catch(() => undefined)
  await reloadAfterRestore()
  toast(`Restored the backup from ${when.charAt(0).toLowerCase()}${when.slice(1)}. Your work from before is saved as a backup too.`, {
    tone: 'success',
    action: safety
      ? {
          label: 'Undo',
          run: () => {
            void (async () => {
              try {
                await flushAll()
                await api.restoreBackup(safety.id)
                await reloadAfterRestore()
                toast('Undone. Your world is back to how it was before the restore.', { tone: 'success' })
              } catch (e) {
                toast((e as Error).message, { tone: 'danger' })
              }
            })()
          }
        }
      : undefined
  })
}

export function BackupsSettings(): React.JSX.Element {
  const world = useApp((s) => s.world)
  if (!world) {
    return (
      <Card>
        <EmptyState icon={<Archive size={20} />} title="Open a world to see its backups">
          Backups are kept with each world. Pick or create a world first, then come back here.
        </EmptyState>
      </Card>
    )
  }
  return (
    <div className="flex flex-col gap-8">
      <BackupList worldId={world.id} worldName={world.name} />
      <SecondFolder />
    </div>
  )
}

function BackupList({ worldId, worldName }: { worldId: string; worldName: string }): React.JSX.Element {
  const [backups, setBackups] = useState<BackupInfo[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [restoringId, setRestoringId] = useState<string | null>(null)
  const [freshId, setFreshId] = useState<string | null>(null)
  const knownIds = useRef<Set<string> | null>(null)

  const load = useCallback(async () => {
    try {
      const list = await api.listBackups()
      // Highlight a backup that appeared since the last load.
      if (knownIds.current) {
        const added = list.find((b) => !knownIds.current!.has(b.id))
        if (added) setFreshId(added.id)
      }
      knownIds.current = new Set(list.map((b) => b.id))
      setBackups(list)
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])

  useEffect(() => {
    void load()
    return onEvent('backup:done', (b) => {
      if (b.worldId === worldId) void load()
    })
  }, [load, worldId])

  useEffect(() => {
    if (!freshId) return
    const t = setTimeout(() => setFreshId(null), 1600)
    return () => clearTimeout(t)
  }, [freshId])

  const showSkeleton = useDelayed(backups === null && !error)

  const backUpNow = async (): Promise<void> => {
    setBusy(true)
    try {
      await flushAll()
      await api.backupNow()
      await load()
    } catch (e) {
      toast((e as Error).message, { tone: 'danger' })
    } finally {
      setBusy(false)
    }
  }

  const doRestore = async (b: BackupInfo): Promise<void> => {
    setRestoringId(b.id)
    try {
      await restore(b.id, formatBackupDate(b.createdAt))
    } catch (e) {
      toast((e as Error).message, { tone: 'danger' })
    } finally {
      setRestoringId(null)
      setConfirmId(null)
      void load()
    }
  }

  return (
    <section>
      <div className="mb-3 flex items-end justify-between gap-4">
        <div className="min-w-0">
          <h2 className="truncate text-[14.5px] font-semibold text-fg">Backups of {worldName}</h2>
          <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted">
            Made when you open the world and every 30 minutes while you write. The last 20 are kept, plus one a day for 30 days.
          </p>
        </div>
        <Button icon={<Archive size={14} />} loading={busy} disabled={!!restoringId} onClick={() => void backUpNow()}>
          Back up now
        </Button>
      </div>

      {error ? (
        <Notice
          tone="danger"
          action={
            <Button size="sm" onClick={() => void load()}>
              Try again
            </Button>
          }
        >
          {error}
        </Notice>
      ) : backups === null ? (
        <Card className="overflow-hidden">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className={cn(ROW_H, 'flex items-center gap-3 border-b border-line px-4 last:border-b-0')}>
              <div className={cn('h-8 w-8 rounded-full bg-surface-2 transition-opacity duration-200', showSkeleton ? 'opacity-100' : 'opacity-0')} />
              <div className={cn('flex flex-col gap-1.5 transition-opacity duration-200', showSkeleton ? 'opacity-100' : 'opacity-0')}>
                <div className="h-3 w-40 rounded bg-surface-2" />
                <div className="h-2.5 w-24 rounded bg-surface-2" />
              </div>
            </div>
          ))}
        </Card>
      ) : backups.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Archive size={20} />}
            title="No backups yet"
            actions={
              <Button variant="primary" loading={busy} onClick={() => void backUpNow()}>
                Back up now
              </Button>
            }
          >
            AI Write makes one when you open a world and every 30 minutes while you write.
          </EmptyState>
        </Card>
      ) : (
        <Card className="overflow-hidden animate-fade-in">
          <ul aria-label="Backups">
            {backups.map((b) => (
              <BackupRow
                key={b.id}
                backup={b}
                fresh={b.id === freshId}
                confirming={confirmId === b.id}
                restoring={restoringId === b.id}
                locked={!!restoringId}
                onAsk={() => setConfirmId(b.id)}
                onCancel={() => setConfirmId(null)}
                onRestore={() => void doRestore(b)}
              />
            ))}
          </ul>
        </Card>
      )}
    </section>
  )
}

function BackupRow({
  backup,
  fresh,
  confirming,
  restoring,
  locked,
  onAsk,
  onCancel,
  onRestore
}: {
  backup: BackupInfo
  fresh: boolean
  confirming: boolean
  restoring: boolean
  locked: boolean
  onAsk: () => void
  onCancel: () => void
  onRestore: () => void
}): React.JSX.Element {
  const when = formatBackupDate(backup.createdAt)
  const confirmRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (confirming) confirmRef.current?.focus()
  }, [confirming])

  return (
    <li
      data-backup-id={backup.id}
      onKeyDown={(e) => {
        if (confirming && e.key === 'Escape' && !restoring) onCancel()
      }}
      className={cn(
        ROW_H,
        'flex items-center gap-3 border-b border-line px-4 transition-colors last:border-b-0',
        confirming ? 'bg-surface-2 duration-150' : fresh ? 'bg-accent-soft duration-150' : 'bg-transparent duration-700'
      )}
    >
      {confirming ? (
        <>
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
            <RotateCcw size={15} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13.5px] font-medium text-fg">Go back to {when.charAt(0).toLowerCase() + when.slice(1)}?</p>
            <p className="truncate text-[12px] text-muted">Your current work is backed up first, so you can undo this.</p>
          </div>
          <Button size="sm" variant="ghost" disabled={restoring} onClick={onCancel}>
            Cancel
          </Button>
          <Button ref={confirmRef} size="sm" variant="primary" loading={restoring} onClick={onRestore}>
            Restore
          </Button>
        </>
      ) : (
        <>
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-2 text-muted">{REASON_ICONS[backup.reason] ?? <Archive size={15} />}</div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13.5px] font-medium text-fg">{when}</p>
            <p className="truncate text-[12px] text-muted">
              {reasonLabel(backup.reason)}
              <span className="px-1.5 text-faint">·</span>
              <span className="tabular-nums">{formatSize(backup.sizeBytes)}</span>
            </p>
          </div>
          <Button size="sm" variant="ghost" icon={<RotateCcw size={13} />} disabled={locked} onClick={onAsk} aria-label={`Restore the backup from ${when}`}>
            Restore
          </Button>
        </>
      )}
    </li>
  )
}

function SecondFolder(): React.JSX.Element {
  const [status, setStatus] = useState<BackupFolderStatus | null>(null)
  const [choosing, setChoosing] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setStatus(await api.getBackupFolderStatus())
    } catch {
      setStatus({ folder: null, ok: true, message: null, lastCopyAt: null })
    }
  }, [])

  useEffect(() => {
    void load()
    let t: ReturnType<typeof setTimeout> | undefined
    const off = onEvent('backup:done', () => {
      // The copy to the second folder follows each backup; look again once it has had time.
      clearTimeout(t)
      t = setTimeout(() => void load(), 1500)
    })
    return () => {
      off()
      clearTimeout(t)
    }
  }, [load])

  const syncSettings = async (): Promise<void> => {
    useApp.setState({ settings: await api.getSettings() })
  }

  const choose = async (): Promise<void> => {
    setChoosing(true)
    setProblem(null)
    try {
      const folder = await api.chooseBackupFolder()
      if (folder) {
        await syncSettings()
        await load()
      }
    } catch (e) {
      setProblem((e as Error).message)
    } finally {
      setChoosing(false)
    }
  }

  const remove = async (): Promise<void> => {
    const previous = status?.folder ?? null
    setProblem(null)
    try {
      await api.clearBackupFolder()
      await syncSettings()
      await load()
      if (previous) {
        toast('Backups are no longer copied to your second folder.', {
          action: {
            label: 'Undo',
            run: () => {
              void useApp
                .getState()
                .updateSettings({ backup: { extraFolder: previous } })
                .then(load)
            }
          }
        })
      }
    } catch (e) {
      toast((e as Error).message, { tone: 'danger' })
    }
  }

  return (
    <section>
      <SectionTitle>Second backup folder</SectionTitle>
      <Card className="p-4">
        {status === null ? (
          <div className="h-[60px]" />
        ) : status.folder ? (
          <div className="flex flex-col gap-3 animate-fade-in">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
                <CloudUpload size={15} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13.5px] font-medium text-fg" title={status.folder}>
                  {status.folder}
                </p>
                <p className="truncate text-[12px] text-muted">
                  {status.ok
                    ? status.lastCopyAt
                      ? `A copy of every backup goes here. Last copied ${timeAgo(status.lastCopyAt)}.`
                      : 'A copy of every backup goes here, in a folder named after the world.'
                    : 'Copies are paused for now.'}
                </p>
              </div>
              <Button size="sm" variant="ghost" icon={<FolderOpen size={13} />} onClick={() => void api.showInFolder(status.folder!)}>
                Open
              </Button>
              <Button size="sm" loading={choosing} onClick={() => void choose()}>
                Change…
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void remove()}>
                Remove
              </Button>
            </div>
            {!status.ok && status.message ? <Notice>{status.message}</Notice> : null}
          </div>
        ) : (
          <div className="flex items-center gap-3 animate-fade-in">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-2 text-muted">
              <Folder size={15} />
            </div>
            <p className="min-w-0 flex-1 text-[13px] leading-relaxed text-muted">
              Keep a copy of every backup somewhere else too, such as a Dropbox, OneDrive or iCloud folder, so your writing is safe even if this computer
              isn't.
            </p>
            <Button loading={choosing} onClick={() => void choose()}>
              Choose folder…
            </Button>
          </div>
        )}
        {problem ? (
          <div className="mt-3">
            <Notice tone="danger">{problem}</Notice>
          </div>
        ) : null}
      </Card>
    </section>
  )
}
