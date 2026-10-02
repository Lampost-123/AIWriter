import { Archive, Clock, DoorOpen, Folder, FolderOpen, Hand, History, RotateCcw, CircleArrowUp, CloudUpload } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import type { BackupFolderStatus, BackupInfo } from '@shared/types'
import { Button, Card, EmptyState, Notice, SettingsSection, toast } from '@/components/ui'
import { api, onEvent } from '@/lib/api'
import { discardAll, flushAll } from '@/lib/flush'
import { useApp } from '@/lib/store'
import { cn } from '@/lib/cn'
import { requestEditorFocus } from '@/features/editor/focusRequest'
import { formatBackupDate, formatSize, inSentence, reasonLabel, timeAgo } from './backupText'

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
async function reloadAfterRestore(refocus: boolean): Promise<void> {
  // Whatever the open views still hold is from before the restore: drop it, never save it.
  discardAll()
  try {
    const before = useApp.getState().outlineRev
    await useApp.getState().init()
    // init() starts the outline count again from 0, so a plain bump could land back on the old
    // value and views watching it would never reload. Move it strictly past where it was.
    useApp.setState((s) => ({ outlineRev: Math.max(s.outlineRev, before) + 1 }))
    useApp.getState().bumpEntries()
  } finally {
    // The editor on screen was let go of above, and init() hands back the same scene id, so it
    // would keep showing the text from before. Mount it afresh (even if reloading failed) so it
    // loads the restored text. Both changes land in the same task, so nothing flashes.
    const { sceneId } = useApp.getState()
    if (sceneId) {
      if (refocus) requestEditorFocus(sceneId)
      flushSync(() => useApp.setState({ sceneId: null }))
      useApp.setState({ sceneId })
    }
  }
}

/** After a failed restore the world may not have reopened: show that, not a workspace that no longer works. */
async function recheckWorld(): Promise<void> {
  const open = await api.getWorld().catch(() => null)
  if (!open) await useApp.getState().init()
}

const DRAFT_RUNNING = 'A draft is being written. Stop it or let it finish, then restore.'

/** Keys pressed while the world's file is being swapped go nowhere (no shortcut, no typing). */
const swallowKey = (e: KeyboardEvent): void => {
  e.preventDefault()
  e.stopImmediatePropagation()
}

/**
 * Swaps the world's file for a backup with the workspace closed to input, so nothing typed
 * meanwhile can be saved into the wrong copy of the world. Everything is saved first.
 */
async function restoreAndReload(id: string): Promise<void> {
  if (useApp.getState().activeGeneration) throw new Error(DRAFT_RUNNING)
  const refocus = !!(document.activeElement as HTMLElement | null)?.closest?.('.scene-prose')
  flushSync(() => useApp.setState({ restoring: true }))
  window.addEventListener('keydown', swallowKey, true)
  try {
    await flushAll()
    await api.restoreBackup(id)
    await reloadAfterRestore(refocus)
  } finally {
    window.removeEventListener('keydown', swallowKey, true)
    useApp.setState({ restoring: false })
  }
}

async function restore(id: string, when: string): Promise<void> {
  await restoreAndReload(id)
  // The restore has happened: from here on nothing may turn it into an error.
  const safety = await api
    .listBackups()
    .then((list) => list.find((b) => b.reason === 'before-restore'))
    .catch(() => undefined)
  toast(`Restored the backup from ${inSentence(when)}. Your work from before is saved as a backup too.`, {
    tone: 'success',
    action: safety
      ? {
          label: 'Undo',
          run: () => {
            void (async () => {
              try {
                await restoreAndReload(safety.id)
                toast('Undone. Your world is back to how it was before the restore.', { tone: 'success' })
              } catch (e) {
                toast((e as Error).message, { tone: 'danger' })
                await recheckWorld()
              }
            })()
          }
        }
      : undefined
  })
}

export function BackupsSettings(): React.JSX.Element {
  const world = useApp((s) => s.world)
  // Both parts load in a moment. Show them together once they have, so the page never paints a
  // placeholder for a single frame and then jumps; a slow load gets its placeholder after 200 ms.
  const [listReady, setListReady] = useState(false)
  const [folderReady, setFolderReady] = useState(false)
  const settled = listReady && folderReady
  const late = useDelayed(!settled)
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
    <div className={cn('flex flex-col gap-9', !settled && !late && 'invisible')}>
      <BackupList worldId={world.id} worldName={world.name} onSettled={() => setListReady(true)} />
      <SecondFolder onSettled={() => setFolderReady(true)} />
    </div>
  )
}

function BackupList({ worldId, worldName, onSettled }: { worldId: string; worldName: string; onSettled: () => void }): React.JSX.Element {
  const [backups, setBackups] = useState<BackupInfo[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [restoringId, setRestoringId] = useState<string | null>(null)
  const [freshId, setFreshId] = useState<string | null>(null)
  const knownIds = useRef<Set<string> | null>(null)
  const settled = useRef(onSettled)
  settled.current = onSettled

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
    } finally {
      settled.current()
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
      await recheckWorld()
    } finally {
      setRestoringId(null)
      setConfirmId(null)
      void load()
    }
  }

  return (
    <SettingsSection
      title={`Backups of ${worldName}`}
      description="Made when you open the world and every 30 minutes while you write. The last 20 are kept, plus one a day for 30 days."
      actions={
        <Button icon={<Archive size={14} />} loading={busy} disabled={!!restoringId} onClick={() => void backUpNow()}>
          Back up now
        </Button>
      }
    >

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
    </SettingsSection>
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
  const askRef = useRef<HTMLButtonElement>(null)
  const wasConfirming = useRef(false)
  useEffect(() => {
    if (confirming) confirmRef.current?.focus()
    // After Cancel or Escape, keyboard focus goes back to this row's Restore button, not the page.
    else if (wasConfirming.current && (!document.activeElement || document.activeElement === document.body)) askRef.current?.focus()
    wasConfirming.current = confirming
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
            <p className="truncate text-[13.5px] font-medium text-fg">Go back to {inSentence(when)}?</p>
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
        </>
      )}
    </li>
  )
}

function SecondFolder({ onSettled }: { onSettled: () => void }): React.JSX.Element {
  const [status, setStatus] = useState<BackupFolderStatus | null>(null)
  const [choosing, setChoosing] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const settled = useRef(onSettled)
  settled.current = onSettled

  const load = useCallback(async () => {
    try {
      setStatus(await api.getBackupFolderStatus())
    } catch {
      setStatus({ folder: null, ok: true, message: null, lastCopyAt: null })
    } finally {
      settled.current()
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
                .catch((e: Error) => toast(e.message, { tone: 'danger' }))
            }
          }
        })
      }
    } catch (e) {
      toast((e as Error).message, { tone: 'danger' })
    }
  }

  return (
    <SettingsSection title="Second backup folder">
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
    </SettingsSection>
  )
}
